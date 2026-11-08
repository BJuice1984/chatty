"""Vacation forms: wizard payload on the assistant dialog state.

assistant_dialog_state gains one nullable ``payload`` Text column — the
JSON blob of the forms wizards (chosen form kind, selected period,
collected dates — D-F-11). Nothing else changes: the wizard step names
live inside the existing String(32) ``state`` column with a closed
dictionary (longest 'form:vacation:choose_period' = 27 chars, unit-pinned).

Both directions of THIS segment are proven inside pytest on SQLite
(tests/integration/test_migration_016_forms_segment.py, the 011/015
template: stamp head → downgrade '015_vacations' → upgrade head); the
full chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 016_vacation_forms
Revises: 015_vacations
Create Date: 2026-11-08
"""

from alembic import op
import sqlalchemy as sa

revision = '016_vacation_forms'
down_revision = '015_vacations'
branch_labels = None
depends_on = None

_TABLE = 'assistant_dialog_state'


def upgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        batch.add_column(sa.Column('payload', sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column('payload')
