// Тестовая инфраструктура (подключается в .mocharc.json рядом с
// mochaSetup.ts): mocha подхватывает mochaHooks из required-файлов.
//
// Подписки withStore-компонентов, не снятых destroy() в тестах, утекали в
// глобальный стор и будились каждым store.set до конца сьюта — на медленной
// машине накопленные перерисовки не влезали в mocha-дефолт 2000 мс
// (LIVE-фикс 2026-10-24 поднимал таймаут одному тесту; теперь причина
// устранена). Снимаем всех слушателей Updated после каждого теста: живые
// внутри теста подписки умирают вместе с ним, между тестами — тишина.
import type { RootHookObject } from 'mocha'
import store, { StoreEvents } from './Store.ts'

export const mochaHooks: RootHookObject = {
    afterEach() {
        store.offAll(StoreEvents.Updated)
    },
}
