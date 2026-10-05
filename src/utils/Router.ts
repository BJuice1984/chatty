import Block from '../core/Block.ts'

type BlockClass = typeof Block
type BlockLoader = () => Promise<BlockClass | { default: BlockClass }>

// eslint-disable-next-line no-unused-vars
type RouteGuard = (to: string, from: string | null) => boolean | string

export interface RouteOptions {
    // eslint-disable-next-line no-unused-vars
    onLazyError?: (error: unknown) => void
}

function escapeRegExp(pathname: string) {
    return pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compilePattern(pathname: string) {
    const source = escapeRegExp(pathname).replace(/:[^/]+/g, '([^/]+)')

    return new RegExp(`^${source}$`)
}

function paramNames(pathname: string) {
    return Array.from(pathname.matchAll(/:([^/]+)/g)).map(match => match[1])
}

function render(query: string, block: Block) {
    const root = document.querySelector(query)

    if (root === null) {
        throw new Error(`root not found by selector "${query}"`)
    }

    root.innerHTML = ''

    root.append(block.getContent()!)

    return root
}

function normalizeLoaded(loaded: BlockClass | { default: BlockClass }): BlockClass {
    if (typeof loaded === 'function') {
        return loaded
    }

    return loaded.default
}

class Route {
    private block: Block | null = null
    private blockClass: BlockClass | null = null
    private loader: BlockLoader | null = null
    private loading = false
    private detached = false
    private params: Record<string, string> = {}
    private readonly pattern: RegExp
    private readonly paramKeys: string[]

    constructor(
        private pathname: string,
        blockOrLoader: BlockClass | BlockLoader,
        // eslint-disable-next-line no-unused-vars
        private readonly query: string,
        // eslint-disable-next-line no-unused-vars
        private readonly options: RouteOptions = {},
        // eslint-disable-next-line no-unused-vars
        private readonly onRouteError?: (error: unknown) => void
    ) {
        if (typeof blockOrLoader === 'function') {
            const candidate = blockOrLoader as BlockClass

            // класс компонента наследует Block.prototype, loader — обычная функция
            if (candidate.prototype instanceof Block) {
                this.blockClass = candidate
            } else {
                this.loader = blockOrLoader as BlockLoader
            }
        }

        this.pattern = compilePattern(pathname)
        this.paramKeys = paramNames(pathname)
    }

    get path() {
        return this.pathname
    }

    leave() {
        this.block?.destroy()
        this.block = null
    }

    // уход с маршрута: блокирует монтирование опоздавших lazy-загрузок
    detach() {
        this.detached = true
        this.leave()
    }

    attach() {
        this.detached = false
    }

    match(pathname: string) {
        return this.pattern.test(pathname)
    }

    getParams(pathname: string): Record<string, string> {
        const match = pathname.match(this.pattern)

        if (match === null) {
            return {}
        }

        return this.paramKeys.reduce<Record<string, string>>((acc, name, index) => {
            acc[name] = match[index + 1]

            return acc
        }, {})
    }

    async render(pathname: string): Promise<void> {
        this.params = this.getParams(pathname)

        if (this.block) {
            // повторный заход на тот же маршрут с новым значением параметра
            this.block.setProps({ routeParams: this.params })

            return
        }

        if (this.blockClass) {
            this.mount()

            return
        }

        if (this.loader && !this.loading) {
            this.loading = true

            try {
                const loaded = await this.loader()

                // маршрут покинули, пока loader был pending
                if (this.detached) {
                    return
                }

                this.blockClass = normalizeLoaded(loaded)
                this.mount()
            } catch (error) {
                if (!this.detached) {
                    this.options.onLazyError?.(error)
                    this.onRouteError?.(error)
                }
            } finally {
                this.loading = false
            }
        }
    }

    private mount() {
        if (this.blockClass === null) {
            return
        }

        this.block = new this.blockClass({ routeParams: this.params })
        render(this.query, this.block)
    }
}

class Router {
    private static __instance: Router
    private static MAX_REDIRECTS = 10
    private routes: Route[] = []
    private currentRoute: Route | null = null
    private history = window.history
    private guards: RouteGuard[] = []
    private errorBlockClass: BlockClass | null = null
    private errorBlock: Block | null = null
    private redirectDepth = 0
    private notFoundPath = '/404'
    private currentParams: Record<string, string> = {}

    // eslint-disable-next-line no-unused-vars
    constructor(private readonly rootQuery: string) {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (Router.__instance) {
            return Router.__instance
        }

        this.routes = []

        Router.__instance = this
    }

    public use(pathname: string, blockOrLoader: BlockClass | BlockLoader, options?: RouteOptions) {
        const route = new Route(
            pathname,
            blockOrLoader,
            this.rootQuery,
            options,
            error => this.renderError(error)
        )

        this.routes.push(route)

        return this
    }

    public error(block: BlockClass) {
        this.errorBlockClass = block

        return this
    }

    public beforeEach(guard: RouteGuard): () => void {
        this.guards.push(guard)

        return () => {
            this.guards = this.guards.filter(item => item !== guard)
        }
    }

    public start() {
        window.onpopstate = (event: PopStateEvent) => {
            const target = event.currentTarget as Window

            this._onRoute(target.location.pathname)
        }

        this._onRoute(window.location.pathname)
    }

    private _onRoute(pathname: string) {
        const verdict = this.runGuards(pathname)

        if (verdict === false) {
            this.redirectDepth = 0

            return
        }

        if (typeof verdict === 'string') {
            if (verdict === pathname) {
                return
            }

            this.redirectDepth += 1

            if (this.redirectDepth > Router.MAX_REDIRECTS) {
                this.redirectDepth = 0

                return
            }

            this.go(verdict)

            return
        }

        const route = this.getRoute(pathname)

        if (!route) {
            this.renderNotFound()

            return
        }

        if (this.currentRoute && this.currentRoute !== route) {
            this.currentRoute.detach()
        }

        this.currentRoute = route
        this.currentParams = route.getParams(pathname)
        this.redirectDepth = 0
        this.errorBlock?.destroy()
        this.errorBlock = null
        route.attach()

        void route.render(pathname)
    }

    private runGuards(pathname: string): boolean | string {
        const from = this.currentRoute?.path ?? null

        for (const guard of this.guards) {
            const verdict = guard(pathname, from)

            if (verdict === false || typeof verdict === 'string') {
                return verdict
            }
        }

        return true
    }

    private renderNotFound() {
        const notFoundRoute = this.getRoute(this.notFoundPath)

        if (!notFoundRoute || notFoundRoute === this.currentRoute) {
            return
        }

        this.currentRoute?.detach()

        this.currentRoute = notFoundRoute
        this.currentParams = {}
        this.redirectDepth = 0
        notFoundRoute.attach()

        void notFoundRoute.render(this.notFoundPath)
    }

    private renderError(error: unknown) {
        if (this.errorBlockClass) {
            this.errorBlock?.destroy()
            this.errorBlock = new this.errorBlockClass({ error })
            render(this.rootQuery, this.errorBlock)
        }
    }

    public getParams() {
        return this.currentParams
    }

    public go(pathname: string) {
        this.history.pushState({}, '', pathname)

        this._onRoute(pathname)
    }

    public back() {
        this.history.back()
    }

    public forward() {
        this.history.forward()
    }

    private getRoute(pathname: string) {
        return this.routes.find(route => route.match(pathname))
    }
}

export default new Router('#app')
