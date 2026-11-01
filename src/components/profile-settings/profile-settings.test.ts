// Пункт сайдбара настроек (2026-11-01-settings): клик зовёт ЖИВОЙ onClick
// из this.props (LIVE-7 — замыкание конструктора устаревает после перерисовок),
// активный пункт подсвечен модификатором _active, имя — двойными скобками
// (XSS). Шаблон грузится тестовым погрузчиком (прецедент — ai-assistant).

import { expect } from 'chai'
import sinon from 'sinon'
import '../../features/ai-assistant/hbs-test-loader.ts'
import { ProfileSettingsItem } from './profile-settings.ts'

const itemProps = {
    'setting-name': 'Appearance',
    'setting-img-src': '/images/appearance-icon.svg',
    'setting-alt': 'Иконка. Солнышко',
}

describe('profile settings item', () => {
    it('renders the setting name', () => {
        const item = new ProfileSettingsItem({ ...itemProps })

        expect(item.element?.querySelector('.profile-settings-item__name')?.textContent?.trim()).to.equal('Appearance')
        expect(item.element?.classList.contains('profile-settings-item')).to.be.true

        item.destroy()
    })

    it('fires onClick on the element click', () => {
        const onClick = sinon.spy()
        const item = new ProfileSettingsItem({ ...itemProps, onClick })

        item.element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(onClick.calledOnce).to.be.true

        item.destroy()
    })

    it('reads the callback from live props, not the constructor closure (LIVE-7)', () => {
        const stale = sinon.spy()
        const fresh = sinon.spy()
        const item = new ProfileSettingsItem({ ...itemProps, onClick: stale })

        item.setProps({ onClick: fresh })
        item.element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(fresh.calledOnce).to.be.true
        expect(stale.called).to.be.false

        item.destroy()
    })

    it('stays silent without a callback', () => {
        const item = new ProfileSettingsItem({ ...itemProps })

        expect(() => item.element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))).to.not.throw()

        item.destroy()
    })

    it('marks the active item with the _active modifier', () => {
        const active = new ProfileSettingsItem({ ...itemProps, isActive: true })
        const idle = new ProfileSettingsItem({ ...itemProps })

        expect(active.element?.classList.contains('profile-settings-item_active')).to.be.true
        expect(idle.element?.classList.contains('profile-settings-item_active')).to.be.false

        active.destroy()
        idle.destroy()
    })

    it('renders a hostile setting name as text (XSS)', () => {
        const item = new ProfileSettingsItem({ ...itemProps, 'setting-name': '<script>alert(1)</script>' })

        expect(item.element?.querySelector('script')).to.not.exist
        expect(item.element?.querySelector('.profile-settings-item__name')?.innerHTML).to.contain('&lt;script&gt;')

        item.destroy()
    })
})
