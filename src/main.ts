// Композиционный корень (stage 4): регистрация компонентов, модулей и маршрутов.
// Замечание stage 3 (createApp без rollback) учтено: порядок бутстрапа
// детерминирован (auth → chats → profile), исключение в setup прерывает
// инициализацию приложения целиком.

import { registerComponent } from './core/registerComponent.ts'
import * as Components from './components/components.ts'
import Block from './core/Block.ts'
import { createApp } from './core/app.ts'
import { featureModules } from './features/index.ts'
import { LoginPage } from './features/auth/pages/login/login.ts'
import { RegisterPage } from './features/auth/pages/register/register.ts'
import { ChatPage } from './features/chats/pages/chat/chat.ts'
import { ProfilePage } from './features/profile/pages/profile/profile.ts'
import { NotFoundPage } from './pages/404/404.ts'
import { ServerErrorPage } from './pages/500/500.ts'
import Router from './utils/Router.ts'
import authController from './features/auth/controller.ts'
import chatsController from './features/chats/controller.ts'
import { MESSENGER, PROFILE, SIGNIN, SIGNUP } from './utils/constants.ts'

export const Routes = {
    Chatty: MESSENGER,
    Login: SIGNIN,
    Register: SIGNUP,
    Profile: PROFILE,
    PageNotFound: '/404',
    ServerErrorPage: '/500',
}

Object.entries(Components).forEach(([name, component]) => {
    registerComponent(name, component as typeof Block)
})

createApp(featureModules)

// eslint-disable-next-line @typescript-eslint/no-misused-promises
document.addEventListener('DOMContentLoaded', async () => {
    Router.use(Routes.Chatty, ChatPage as typeof Block)
        .use(Routes.Login, LoginPage as typeof Block)
        .use(Routes.Register, RegisterPage as typeof Block)
        .use(Routes.Profile, ProfilePage as typeof Block)
        .use(Routes.PageNotFound, NotFoundPage as typeof Block)
        .use(Routes.ServerErrorPage, ServerErrorPage as typeof Block)

    Router.start()

    let isProtectedRoute = true

    switch (document.location.pathname) {
        case Routes.Login:
        case Routes.Register:
            isProtectedRoute = false

            break
    }

    try {
        await authController.fetchUser()
        await chatsController.fetchChats()
    } catch (e) {
        console.error(e)
        console.log('🚀 ~ document.addEventListener ~ error:')

        if (!isProtectedRoute) {
            Router.go(Routes.Login)
        }
    }
})
