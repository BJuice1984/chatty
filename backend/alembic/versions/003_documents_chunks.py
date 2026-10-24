"""Add ingested documents and chunks with portable JSON embeddings."""

from alembic import op
import sqlalchemy as sa


revision = '003_documents_chunks'
down_revision = '002_chat_messages_files'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('file_id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='processing'),
        sa.Column('error_kind', sa.String(length=64), nullable=True),
        sa.Column('chunk_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('file_id'),
    )
    op.create_index('ix_documents_file_id', 'documents', ['file_id'], unique=True)
    op.create_index('ix_documents_chat_id', 'documents', ['chat_id'], unique=False)
    op.create_index('ix_documents_owner_id', 'documents', ['owner_id'], unique=False)

    op.create_table(
        'doc_chunks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.Integer(), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('document_id', 'ordinal', name='uq_doc_chunks_document_ordinal'),
    )
    op.create_index('ix_doc_chunks_document_id', 'doc_chunks', ['document_id'], unique=False)
    op.create_index('ix_doc_chunks_chat_id', 'doc_chunks', ['chat_id'], unique=False)
    op.create_index('ix_doc_chunks_file_id', 'doc_chunks', ['file_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_doc_chunks_file_id', table_name='doc_chunks')
    op.drop_index('ix_doc_chunks_chat_id', table_name='doc_chunks')
    op.drop_index('ix_doc_chunks_document_id', table_name='doc_chunks')
    op.drop_table('doc_chunks')
    op.drop_index('ix_documents_owner_id', table_name='documents')
    op.drop_index('ix_documents_chat_id', table_name='documents')
    op.drop_index('ix_documents_file_id', table_name='documents')
    op.drop_table('documents')
