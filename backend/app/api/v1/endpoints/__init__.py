from app.api.v1.endpoints import auth, bot, documents, health

__all__ = ['auth', 'bot', 'documents', 'health']

# Stage-8 composition: the documents domain registers itself through the
# stage-5 seam (app.api.v1.router.register_domain_router) while this package
# initializes. The local import inside register_domain keeps this safe against
# the partially initialized router module; see the package developer-overview.
documents.register_domain()

# Stage-9 composition: the bot domain mounts through the same seam.
bot.register_domain()
