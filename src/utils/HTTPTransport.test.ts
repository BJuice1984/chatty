import { expect } from 'chai'
import sinon from 'sinon'
import HTTPTransport, { TransportError } from './HTTPTransport'
import { readEnv } from './env'

const testEnvironment = readEnv({
    MODE: 'own',
    VITE_API_URL: 'http://localhost:8000/api/v1/',
    VITE_WS_URL: 'ws://localhost:8000/api/v1/',
    VITE_FILES_URL: 'http://localhost:8000/api/v1/files/',
    VITE_CSRF_HEADER_NAME: 'X-CSRF-Token',
})

describe('HTTPTransport', () => {
    describe('URL construction', () => {
        it('should use the configured base URL for GET requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.get('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'GET',
            })).to.be.true
        })

        it('should use the configured base URL for PUT requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.put('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'PUT',
            })).to.be.true
        })

        it('should use the configured base URL for POST requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.post('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'POST',
            })).to.be.true
        })

        it('should use the configured base URL for DELETE requests', () => {
            const transport = new HTTPTransport('/test-endpoint', testEnvironment)
            const requestStub = sinon.stub(transport, 'request' as keyof HTTPTransport)

            transport.delete('/resource')

            expect(requestStub.calledWith('http://localhost:8000/api/v1/test-endpoint/resource', {
                method: 'DELETE',
            })).to.be.true
        })
    })

    it('should forward an explicit CSRF token for state-changing requests', async () => {
        let request: FakeXMLHttpRequest | undefined
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 204
            response: unknown = null
            headers: Record<string, string> = {}
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader(header: string, value: string) {
                this.headers[header] = value
            }

            send() {
                request = this
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            await new HTTPTransport('/auth', testEnvironment).post('/logout', {
                csrfToken: 'csrf-value',
            })
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }

        expect(request?.headers['X-CSRF-Token']).to.equal('csrf-value')
    })

    it('should apply the default request timeout (RV5)', async () => {
        let request: FakeXMLHttpRequest | undefined
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 200
            response: unknown = null
            headers: Record<string, string> = {}
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader() {}

            send() {
                request = this
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            await new HTTPTransport('/chats', testEnvironment).get('/list')
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }

        // Дефолт применяется: без явного options.timeout запрос не висит вечно.
        expect(request?.timeout).to.equal(30000)
    })

    it('should honor a per-request timeout override (RV5, multipart uploads)', async () => {
        let request: FakeXMLHttpRequest | undefined
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 200
            response: unknown = null
            headers: Record<string, string> = {}
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader() {}

            send() {
                request = this
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            // Тяжёлая multipart-загрузка легитимно едет дольше дефолта.
            await new HTTPTransport('/chats', testEnvironment).put('/avatar', { timeout: 120000 })
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }

        expect(request?.timeout).to.equal(120000)
    })

    it('should normalize HTTP errors without depending on ApiError', async () => {
        const originalXMLHttpRequest = globalThis.XMLHttpRequest

        class FakeXMLHttpRequest {
            status = 422
            response = { detail: 'invalid payload' }
            withCredentials = false
            responseType: XMLHttpRequestResponseType = ''
            timeout = 0
            onload: (() => void) | null = null
            onabort: (() => void) | null = null
            onerror: (() => void) | null = null
            ontimeout: (() => void) | null = null

            open() {}

            setRequestHeader() {}

            send() {
                this.onload?.()
            }
        }

        globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

        try {
            await new HTTPTransport('/auth', testEnvironment).post('/login')
            expect.fail('The request should reject')
        } catch (error: unknown) {
            expect(error).to.be.instanceOf(TransportError)
            expect(error).to.have.property('kind', 'http')
            expect(error).to.have.property('status', 422)
            expect(error).to.have.property('message', 'invalid payload')
        } finally {
            globalThis.XMLHttpRequest = originalXMLHttpRequest
        }
    })

    describe('transport policy', () => {
        interface FakeResponse {
            status: number
            response?: unknown
        }

        interface CapturedRequest {
            method: string
            url: string
            headers: Record<string, string>
        }

        let clock: sinon.SinonFakeTimers

        function installSequenceXHR(responses: FakeResponse[]): { captured: CapturedRequest[]; restore: () => void } {
            const originalXMLHttpRequest = globalThis.XMLHttpRequest
            let index = 0
            const captured: CapturedRequest[] = []

            class FakeXMLHttpRequest {
                status = 0
                response: unknown = null
                headers: Record<string, string> = {}
                withCredentials = false
                responseType: XMLHttpRequestResponseType = ''
                timeout = 0
                method = ''
                url = ''
                onload: (() => void) | null = null
                onabort: (() => void) | null = null
                onerror: (() => void) | null = null
                ontimeout: (() => void) | null = null

                open(method: string, url: string) {
                    this.method = method
                    this.url = url
                }

                setRequestHeader(header: string, value: string) {
                    this.headers[header] = value
                }

                send() {
                    const next = responses[Math.min(index, responses.length - 1)]

                    index += 1
                    this.status = next.status
                    this.response = next.response ?? null
                    captured.push({ method: this.method, url: this.url, headers: { ...this.headers } })
                    this.onload?.()
                }
            }

            globalThis.XMLHttpRequest = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest

            return {
                captured,
                restore: () => {
                    globalThis.XMLHttpRequest = originalXMLHttpRequest
                },
            }
        }

        beforeEach(() => {
            clock = sinon.useFakeTimers()
        })

        afterEach(() => {
            HTTPTransport.setTransportPolicy(null)
            clock.restore()
        })

        it('replays the request once after a healed 401 with refreshed csrf options', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
                { status: 200, response: { ok: true } },
            ])
            const onUnauthorized = sinon.stub().resolves(true)
            const onRetryOverlay = sinon.spy()
            const beforeUnauthorizedRetry = sinon.spy((options: { csrfToken?: string }) => {
                options.csrfToken = 'fresh-csrf'
            })

            HTTPTransport.setTransportPolicy({ onUnauthorized, onRetryOverlay, beforeUnauthorizedRetry })

            try {
                const result = await new HTTPTransport('/chats', testEnvironment).post('/messages', {
                    data: { content: 'hi' },
                    csrfToken: 'stale-csrf',
                })

                expect(result).to.eql({ ok: true })
                expect(captured.length).to.equal(2)
                expect(captured[1].headers['X-CSRF-Token']).to.equal('fresh-csrf')
                expect(onRetryOverlay.args).to.eql([['begin', 'unauthorized'], ['end', 'unauthorized']])
            } finally {
                restore()
            }
        })

        it('rejects with the original 401 when the policy gives up', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onUnauthorized: sinon.stub().resolves(false),
                onRetryOverlay,
            })

            try {
                await new HTTPTransport('/chats', testEnvironment).get('/list')
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 401)
                expect(error).to.have.property('message', 'authentication_required')
                expect(captured.length).to.equal(1)
                expect(onRetryOverlay.args).to.eql([['begin', 'unauthorized'], ['end', 'unauthorized']])
            } finally {
                restore()
            }
        })

        it('degrades to a plain rejection when the refresh hook itself throws', async () => {
            const { restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onUnauthorized: sinon.stub().rejects(new Error('refresh internals')),
                onRetryOverlay,
            })

            try {
                await new HTTPTransport('/chats', testEnvironment).get('/list')
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 401)
                expect(onRetryOverlay.args).to.eql([['begin', 'unauthorized'], ['end', 'unauthorized']])
            } finally {
                restore()
            }
        })

        it('never intercepts the five semantic auth endpoints (401 and 500 responses)', async () => {
            const paths = ['/refresh', '/login', '/register', '/logout', '/logout-all']
            const onUnauthorized = sinon.stub().resolves(true)
            const onServerErrorDelay = sinon.stub().returns(1)
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({ onUnauthorized, onServerErrorDelay, onRetryOverlay })

            for (const status of [401, 500]) {
                for (const path of paths) {
                    const { captured, restore } = installSequenceXHR([{ status }])

                    try {
                        await new HTTPTransport('/auth', testEnvironment).post(path)
                        expect.fail(`POST /auth${path} should reject`)
                    } catch {
                        expect(captured.length).to.equal(1)
                    } finally {
                        restore()
                    }
                }
            }

            expect(onUnauthorized.called).to.be.false
            expect(onServerErrorDelay.called).to.be.false
            expect(onRetryOverlay.called).to.be.false
        })

        it('heals a 401 on /auth/me, /auth/profile and /auth/password (endpoint-scoped exclusion)', async () => {
            const cases: Array<{ path: string; send: (transport: HTTPTransport) => Promise<unknown> }> = [
                { path: '/me', send: transport => transport.get('/me') },
                { path: '/profile', send: transport => transport.put('/profile', { data: {} }) },
                { path: '/password', send: transport => transport.put('/password', { data: {} }) },
            ]
            const onUnauthorized = sinon.stub().resolves(true)

            HTTPTransport.setTransportPolicy({ onUnauthorized })

            for (const testCase of cases) {
                const { captured, restore } = installSequenceXHR([
                    { status: 401, response: { detail: 'authentication_required' } },
                    { status: 200, response: { id: 1 } },
                ])

                try {
                    await testCase.send(new HTTPTransport('/auth', testEnvironment))

                    expect(captured.length).to.equal(2, `${testCase.path} should be replayed once`)
                } finally {
                    restore()
                }
            }

            expect(onUnauthorized.callCount).to.equal(3)
        })

        it('retries a 500 on the delay ladder and rejects after the fourth failure', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 500, response: { detail: 'boom' } },
                { status: 500, response: { detail: 'boom' } },
                { status: 500, response: { detail: 'boom' } },
                { status: 500, response: { detail: 'boom' } },
            ])
            const onServerErrorDelay = sinon.stub().callsFake((_url: string, attempt: number) =>
                [2000, 6000, 12000][attempt] ?? null)
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({ onServerErrorDelay, onRetryOverlay })

            try {
                const outcome = new HTTPTransport('/chats', testEnvironment).get('/list')
                const caught = outcome.catch(error => error)

                await clock.tickAsync(20000)

                const error = await caught

                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 500)
                expect(captured.length).to.equal(4)
                expect(onServerErrorDelay.args.map(([, attempt]) => attempt)).to.eql([0, 1, 2])
                expect(onRetryOverlay.args).to.eql([['begin', 'server-error'], ['end', 'server-error']])
            } finally {
                restore()
            }
        })

        it('resolves when an intermediate retry succeeds and hides the overlay', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 503, response: { detail: 'unavailable' } },
                { status: 200, response: { ok: true } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onServerErrorDelay: () => 2000,
                onRetryOverlay,
            })

            try {
                const outcome = new HTTPTransport('/chats', testEnvironment).get('/list')
                const settled = outcome.then(value => ({ value }), error => ({ error }))

                await clock.tickAsync(2000)

                const result = await settled as { value?: unknown; error?: unknown }

                expect(result.error).to.be.undefined
                expect(result.value).to.eql({ ok: true })
                expect(captured.length).to.equal(2)
                expect(onRetryOverlay.args).to.eql([['begin', 'server-error'], ['end', 'server-error']])
            } finally {
                restore()
            }
        })

        it('stops immediately when the policy answers null and never opens the overlay', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 500, response: { detail: 'boom' } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onServerErrorDelay: () => null,
                onRetryOverlay,
            })

            try {
                await new HTTPTransport('/chats', testEnvironment).get('/list')
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 500)
                expect(captured.length).to.equal(1)
                expect(onRetryOverlay.called).to.be.false
            } finally {
                restore()
            }
        })

        it('composes a healed 401 with the 500-retry phase, keeping both overlay pairs balanced', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
                { status: 500, response: { detail: 'boom' } },
                { status: 200, response: { ok: true } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onUnauthorized: sinon.stub().resolves(true),
                onServerErrorDelay: () => 2000,
                onRetryOverlay,
            })

            try {
                const outcome = new HTTPTransport('/chats', testEnvironment).get('/list')
                const settled = outcome.then(value => ({ value }), error => ({ error }))

                await clock.tickAsync(2000)

                const result = await settled as { value?: unknown; error?: unknown }

                expect(result.error).to.be.undefined
                expect(result.value).to.eql({ ok: true })
                expect(captured.length).to.equal(3)
                expect(onRetryOverlay.args).to.eql([
                    ['begin', 'unauthorized'],
                    ['end', 'unauthorized'],
                    ['begin', 'server-error'],
                    ['end', 'server-error'],
                ])
            } finally {
                restore()
            }
        })

        it('does not refresh twice when the replayed request 401s again, rejecting with the ORIGINAL error', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
                { status: 401, response: { detail: 'invalid_token' } },
            ])
            const onUnauthorized = sinon.stub().resolves(true)

            HTTPTransport.setTransportPolicy({ onUnauthorized })

            try {
                await new HTTPTransport('/chats', testEnvironment).get('/list')
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 401)
                expect(error).to.have.property('message', 'authentication_required')
                expect(captured.length).to.equal(2)
                expect(onUnauthorized.calledOnce).to.be.true
            } finally {
                restore()
            }
        })

        it('rejects a post-heal validation error as-is instead of masking it with the stale 401', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
                { status: 422, response: { detail: 'validation_failed' } },
            ])

            HTTPTransport.setTransportPolicy({ onUnauthorized: sinon.stub().resolves(true) })

            try {
                await new HTTPTransport('/auth', testEnvironment).put('/profile', { data: {} })
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 422)
                expect(error).to.have.property('message', 'validation_failed')
                expect(captured.length).to.equal(2)
            } finally {
                restore()
            }
        })

        it('rejects with the last 5xx when a post-heal 500 exhausts the retry budget', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 401, response: { detail: 'authentication_required' } },
                { status: 500, response: { detail: 'boom-1' } },
                { status: 500, response: { detail: 'boom-2' } },
                { status: 500, response: { detail: 'boom-3' } },
                { status: 500, response: { detail: 'boom-final' } },
            ])

            HTTPTransport.setTransportPolicy({
                onUnauthorized: sinon.stub().resolves(true),
                onServerErrorDelay: (_url: string, attempt: number) => [2000, 6000, 12000][attempt] ?? null,
            })

            try {
                const outcome = new HTTPTransport('/chats', testEnvironment).get('/list')
                const caught = outcome.catch(error => error)

                await clock.tickAsync(20000)

                const error = await caught

                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 500)
                expect(error).to.have.property('message', 'boom-final')
                expect(captured.length).to.equal(5)
            } finally {
                restore()
            }
        })

        it('closes an open server-error phase when a retry answers 401 and the policy gives up', async () => {
            const { restore } = installSequenceXHR([
                { status: 500, response: { detail: 'boom' } },
                { status: 401, response: { detail: 'authentication_required' } },
            ])
            const onRetryOverlay = sinon.spy()

            HTTPTransport.setTransportPolicy({
                onUnauthorized: sinon.stub().resolves(false),
                onServerErrorDelay: () => 100,
                onRetryOverlay,
            })

            try {
                const outcome = new HTTPTransport('/chats', testEnvironment).get('/list')
                const caught = outcome.catch(error => error)

                await clock.tickAsync(500)

                const error = await caught

                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 401)
                expect(onRetryOverlay.args).to.eql([
                    ['begin', 'server-error'],
                    ['begin', 'unauthorized'],
                    ['end', 'unauthorized'],
                    ['end', 'server-error'],
                ])
            } finally {
                restore()
            }
        })

        it('leaves a 500 untouched when no policy is installed', async () => {
            const { captured, restore } = installSequenceXHR([
                { status: 500, response: { detail: 'boom' } },
            ])

            HTTPTransport.setTransportPolicy(null)

            try {
                await new HTTPTransport('/chats', testEnvironment).get('/list')
                expect.fail('The request should reject')
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(TransportError)
                expect(error).to.have.property('status', 500)
                expect(captured.length).to.equal(1)
            } finally {
                restore()
            }
        })
    })
})
