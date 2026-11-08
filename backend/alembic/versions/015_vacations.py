"""Vacation skill storage: schedules, periods, names, dialog state.

vacation_schedules holds one xlsx snapshot per ingest (source_name +
year); vacation_periods carries the dated rows with ON DELETE CASCADE
so a replace-per-year re-ingest drops the old rows wholesale;
vacation_names stores each user's confirmed canonical schedule name —
it references the name string, not a snapshot row id, so re-ingests
never break it; assistant_dialog_state keeps the per-user vacation
dialog state (bot runs are stateless and keyed by message_id, so the
pending offer/surname question must survive restarts, D-5).

Both directions of THIS segment are proven inside pytest on SQLite
(tests/integration/test_migration_015_vacations_segment.py, the 011
template: stamp head → downgrade '014_message_kind_widen' → upgrade
head); the full chain keeps its operational proof on the compose
PostgreSQL (docs/deployment/own-backend.md).

Revision ID: 015_vacations
Revises: 014_message_kind_widen
Create Date: 2026-11-08
"""

from alembic import op
import sqlalchemy as sa

revision = '015_vacations'
down_revision = '014_message_kind_widen'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'vacation_schedules',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('source_name', sa.String(length=255), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column(
            'ingested_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column('row_count', sa.Integer(), nullable=False),
    )
    op.create_table(
        'vacation_periods',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            'schedule_id',
            sa.Integer(),
            sa.ForeignKey('vacation_schedules.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('full_name', sa.String(length=120), nullable=False),
        sa.Column('department', sa.String(length=120), nullable=True),
        sa.Column('position', sa.String(length=120), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('days', sa.Integer(), nullable=False),
    )
    op.create_index(
        'ix_vacation_periods_schedule_full_name',
        'vacation_periods',
        ['schedule_id', 'full_name'],
    )
    op.create_table(
        'vacation_names',
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            primary_key=True,
        ),
        sa.Column('schedule_name', sa.String(length=120), nullable=False),
        sa.Column(
            'confirmed_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        'assistant_dialog_state',
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            primary_key=True,
        ),
        sa.Column('state', sa.String(length=32), nullable=False),
        sa.Column('origin_content', sa.Text(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table('assistant_dialog_state')
    op.drop_table('vacation_names')
    op.drop_index('ix_vacation_periods_schedule_full_name', table_name='vacation_periods')
    op.drop_table('vacation_periods')
    op.drop_table('vacation_schedules')
