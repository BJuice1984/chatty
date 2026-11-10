// Безопасный markdown-рендерер ответов бота (2026-11-10): блочные
// конструкции (списки N./N) — репро живого фидбека оператора), инлайны,
// экранирование недоверенного HTML и гейт ссылок по схеме http(s)

import { expect } from 'chai'
import { renderInline, renderMarkdown } from './markdown.ts'

describe('renderMarkdown blocks', () => {
    it('splits paragraphs on blank lines and joins lines with <br>', () => {
        expect(renderMarkdown('первая строка\nвторая строка\n\nновый абзац'))
            .to.equal('<p>первая строка<br>вторая строка</p><p>новый абзац</p>')
    })

    it('renders ordered lists with both N. and N) markers (operator repro)', () => {
        const source = 'Ваши периоды по графику:\n1) с 20.04.2026 на 7 дней\n2) с 03.08.2026 на 14 дней\n3) с 21.12.2026 на 7 дней\nНапишите номер периода — или свою дату.'

        expect(renderMarkdown(source)).to.equal(
            '<p>Ваши периоды по графику:</p>'
            + '<ol><li>с 20.04.2026 на 7 дней</li><li>с 03.08.2026 на 14 дней</li><li>с 21.12.2026 на 7 дней</li></ol>'
            + '<p>Напишите номер периода — или свою дату.</p>'
        )
    })

    it('renders the dot-marker ordered list of the bot answer repro', () => {
        const source = 'есть два варианта:\n1. Согласие за отгул — работник отказывается\n2. Согласие за деньги — работник соглашается'

        expect(renderMarkdown(source)).to.equal(
            '<p>есть два варианта:</p>'
            + '<ol><li>Согласие за отгул — работник отказывается</li><li>Согласие за деньги — работник соглашается</li></ol>'
        )
    })

    it('renders unordered lists with -, * and + markers', () => {
        expect(renderMarkdown('- один\n- два')).to.equal('<ul><li>один</li><li>два</li></ul>')
        expect(renderMarkdown('* один\n* два')).to.equal('<ul><li>один</li><li>два</li></ul>')
        expect(renderMarkdown('+ один\n+ два')).to.equal('<ul><li>один</li><li>два</li></ul>')
    })

    it('glues an indented continuation line into the last list item', () => {
        expect(renderMarkdown('- пункт\n  продолжение пункта\n- второй'))
            .to.equal('<ul><li>пункт продолжение пункта</li><li>второй</li></ul>')
    })

    it('stops the list before a foreign block marker', () => {
        expect(renderMarkdown('1. первый\n## заголовок'))
            .to.equal('<ol><li>первый</li></ol><h4>заголовок</h4>')
        expect(renderMarkdown('- пункт\n1. чужой маркер'))
            .to.equal('<ul><li>пункт</li></ul><ol><li>чужой маркер</li></ol>')
    })

    it('clamps heading levels into h4-h6', () => {
        expect(renderMarkdown('# крупный')).to.equal('<h4>крупный</h4>')
        expect(renderMarkdown('### средний')).to.equal('<h5>средний</h5>')
        expect(renderMarkdown('###### мелкий')).to.equal('<h6>мелкий</h6>')
    })

    it('renders fenced code blocks with escaped body', () => {
        expect(renderMarkdown('```\nconst x = 1 < 2\n```'))
            .to.equal('<pre><code>const x &#x3D; 1 &lt; 2</code></pre>')
        expect(renderMarkdown('текст\n```\nнезакрытый блок')).to.equal(
            '<p>текст</p><pre><code>незакрытый блок</code></pre>'
        )
    })

    it('renders quotes recursively and horizontal rules', () => {
        expect(renderMarkdown('> цитата\n> **жирная**')).to.equal(
            '<blockquote><p>цитата<br><strong>жирная</strong></p></blockquote>'
        )
        expect(renderMarkdown('до\n---\nпосле')).to.equal('<p>до</p><hr><p>после</p>')
    })

    it('normalizes CRLF line endings', () => {
        expect(renderMarkdown('один\r\nдва')).to.equal('<p>один<br>два</p>')
    })
})

describe('renderMarkdown inline', () => {
    it('bold, italic, strike and code spans', () => {
        expect(renderInline('**жирный**')).to.equal('<strong>жирный</strong>')
        expect(renderInline('*курсив*')).to.equal('<em>курсив</em>')
        expect(renderInline('_курсив_')).to.equal('<em>курсив</em>')
        expect(renderInline('~~зачёркнутый~~')).to.equal('<del>зачёркнутый</del>')
        expect(renderInline('код `x = 1` внутри')).to.equal('код <code>x &#x3D; 1</code> внутри')
    })

    it('keeps markdown markers inside code spans untouched', () => {
        expect(renderInline('`**не жирный**`')).to.equal('<code>**не жирный**</code>')
    })

    it('does not italicize mid-word asterisks and underscores', () => {
        expect(renderInline('2 * 3 = 6')).to.equal('2 * 3 &#x3D; 6')
        expect(renderInline('snake_case_имя')).to.equal('snake_case_имя')
    })

    it('builds links only for http(s) schemes', () => {
        expect(renderInline('[док](https://example.com/a?b=1)'))
            .to.equal('<a href="https://example.com/a?b&#x3D;1" target="_blank" rel="noopener noreferrer">док</a>')
        expect(renderInline('[зло](javascript:alert(1))'))
            .to.equal('[зло](javascript:alert(1))')
    })
})

describe('renderMarkdown safety', () => {
    it('escapes raw HTML everywhere (XSS)', () => {
        const hostile = [
            '<script>alert(1)</script>',
            '**<img src=x onerror=alert(1)>**',
            '# <script>alert(2)</script>',
            '- <svg onload=alert(3)>',
            '```\n<script>alert(4)</script>\n```',
            '>[мертвенная ссылка](https://x/"><script>alert(5)</script>)',
        ].join('\n\n')

        const html = renderMarkdown(hostile)

        expect(html).to.not.contain('<script>')
        expect(html).to.not.contain('<img')
        expect(html).to.not.contain('<svg')
        expect(html).to.contain('&lt;script&gt;')
    })

    it('cannot break out of the href attribute with quotes in the url', () => {
        const html = renderInline('[x](https://e.com/a"onmouseover="alert(1))')

        expect(html).to.not.contain('"onmouseover=')
        expect(html).to.contain('&quot;onmouseover&#x3D;')
    })

    it('returns empty markup for empty input', () => {
        expect(renderMarkdown('')).to.equal('')
    })
})
