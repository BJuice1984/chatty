// Мини-рендерер markdown-подмножества для ответов бота (2026-11-10):
// модель отвечает маркдауном (**жирный**, списки, `код`), а лента до сих пор
// показывала его сырыми маркерами сплошным текстом. Требование безопасности:
// контент бота — недоверенный (RAG тянет чужие документы, промпт-инъекция
// может пронести <script>), поэтому НИКАКОЙ сырой HTML не пропускается —
// весь текст проходит Handlebars.escapeExpression ДО подстановки в разметку,
// ссылки собираются только на http(s). Поддержка: параграфы (<br> на
// одиночном переносе — чатовая семантика), заголовки #-###### (клампятся в
// h4-h6 — h1-h3 разрывали бы пузырь), ul (-, *, +), ol (N. и N)), цитаты >,
// --- линия, fenced-блоки ```, инлайны **жирный**, *курсив*, _курсив_,
// ~~зачёркнутый~~, `код`, [текст](https://…). Вложенные списки и таблицы не
// поддерживаются — бот их не выдаёт, разбор остаётся плоским и предсказуемым.
import Handlebars from 'handlebars'

const escapeHtml = (value: string): string => Handlebars.escapeExpression(value)

// Заголовки #..###### -> h4..h6: единицы уровня схлопываются (1-2 -> h4,
// 3-4 -> h5, 5-6 -> h6) — в пузыре сообщения всё это один и тот же
// «подзаголовок», крупная типографика не нужна
function headingTag(level: number): string {
    if (level <= 2) {
        return 'h4'
    }

    if (level <= 4) {
        return 'h5'
    }

    return 'h6'
}

// Инлайновая разметка вне код-спанов: работаем по уже экранированному
// тексту. Порядок замен важен: ссылки до жирного (текст ссылки ещё
// разберётся **…**-проходом), курсив последним — чтобы не съесть звёзды
// жирного
function renderEmphasized(raw: string): string {
    let text = escapeHtml(raw)

    // [текст](url): ссылка собирается только на http(s) — javascript: и
    // прочие схемы остаются обычным текстом; url уже экранирован (кавычки —
    // &quot;), разорвать атрибут href невозможно
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)

    text = text.replace(/\*\*([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    text = text.replace(/~~([\s\S]*?\S)~~/g, '<del>$1</del>')

    // курсив: маркер только после пробела/начала/открывающей скобки —
    // «2 * 3» и snake_case не превращаются в разметку
    text = text.replace(/(^|[\s(])\*([^*\n]*?\S)\*/g, '$1<em>$2</em>')
    text = text.replace(/(^|[\s(])_([^_\n]*?\S)_\b/g, '$1<em>$2</em>')

    return text
}

// Инлайновая разметка одной строки: код-спаны `…` вынимаются из обработки
// целиком (split с захватом разделителя — чётные куски обычный текст,
// нечётные код), их содержимое экранируется, но не размечается
export function renderInline(source: string): string {
    return source
        .split(/(`[^`]+`)/)
        .map(part =>
            part.length > 2 && part.startsWith('`') && part.endsWith('`')
                ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
                : renderEmphasized(part))
        .join('')
}

const RE_FENCE = /^```/
// маркеры блоков отделены от контента slice'ом: квантификатор маркера и
// остаток строки не конкурируют за одни символы (без polynomial backtracking)
const RE_HEADING = /^(#{1,6})[ \t]+/
const RE_HR = /^([-*_])[ \t]*(?:\1[ \t]*){2,}$/
const RE_UL_ITEM = /^[-*+][ \t]+/
const RE_OL_ITEM = /^\d{1,9}[.)][ \t]+/

// Строка-стоппер внутри пункта списка: чужой блочный маркер продолжение
// не приклеивает — начинается новый блок
const RE_LIST_BREAK = /^(?:```|#{1,6}[ \t]|>)/

// Читает один список (маркеры одного вида подряд) начиная с index;
// строка с отступом 2+ — продолжение последнего пункта (многострочный
// пункт склеивается пробелом). Возвращает HTML <ul>/<ol> и новый индекс
function readList(
    lines: string[],
    start: number,
    ordered: boolean
): { html: string, next: number } {
    const marker = ordered ? RE_OL_ITEM : RE_UL_ITEM
    const items: string[] = []

    let index = start

    while (index < lines.length) {
        const line = lines[index]
        const trimmed = line.trim()

        if (trimmed === '' || RE_LIST_BREAK.test(trimmed)) {
            break
        }

        const match = marker.exec(trimmed)

        if (match != null) {
            items.push(trimmed.slice(match[0].length))
            index += 1

            continue
        }

        // чужой маркер списка того же ряда — тоже граница (ul после ol)
        if ((ordered ? RE_UL_ITEM : RE_OL_ITEM).test(trimmed)) {
            break
        }

        // продолжение пункта: отступ и не пустая строка приклеиваются
        // к последнему пункту; без отступа текст выпадает из списка —
        // «ленивое» продолжение не поддерживаем, как и вложенность
        if (/^[ \t]{2,}\S/.test(line) && items.length > 0) {
            items[items.length - 1] += ` ${trimmed}`
            index += 1

            continue
        }

        break
    }

    const tag = ordered ? 'ol' : 'ul'
    const html = `<${tag}>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`

    return { html, next: index }
}

// Блочный разбор: строка за строкой собирает код-блоки, заголовки,
// цитаты (рекурсивно — внутри цитаты работает тот же markdown), списки,
// линии и параграфы; строки параграфа склеиваются <br> — перенос строки
// в чате значим, схлопывать его в пробел нельзя (пользователь видит
// сплошной текст)
export function renderMarkdown(source: string): string {
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const html: string[] = []
    const paragraph: string[] = []

    const flushParagraph = () => {
        if (paragraph.length > 0) {
            html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
            paragraph.length = 0
        }
    }

    let index = 0

    while (index < lines.length) {
        const line = lines[index]
        const trimmed = line.trim()

        if (trimmed === '') {
            flushParagraph()
            index += 1

            continue
        }

        if (RE_FENCE.test(trimmed)) {
            flushParagraph()

            const body: string[] = []

            index += 1

            while (index < lines.length && !RE_FENCE.test(lines[index].trim())) {
                body.push(lines[index])
                index += 1
            }

            // закрывающая ``` или конец текста — оба варианта валидны
            index += 1
            html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)

            continue
        }

        const heading = RE_HEADING.exec(trimmed)

        if (heading != null) {
            flushParagraph()
            const tag = headingTag(heading[1].length)

            html.push(`<${tag}>${renderInline(trimmed.slice(heading[0].length))}</${tag}>`)
            index += 1

            continue
        }

        if (RE_HR.test(trimmed)) {
            flushParagraph()
            html.push('<hr>')
            index += 1

            continue
        }

        if (trimmed.startsWith('>')) {
            flushParagraph()

            const quote: string[] = []

            while (index < lines.length && lines[index].trim().startsWith('>')) {
                quote.push(lines[index].trim().replace(/^>\s?/, ''))
                index += 1
            }

            html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`)

            continue
        }

        const ordered = RE_OL_ITEM.test(trimmed)

        if (ordered || RE_UL_ITEM.test(trimmed)) {
            flushParagraph()
            const list = readList(lines, index, ordered)

            html.push(list.html)
            index = list.next

            continue
        }

        paragraph.push(trimmed)
        index += 1
    }

    flushParagraph()

    return html.join('')
}
