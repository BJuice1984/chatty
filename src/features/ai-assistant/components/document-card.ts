// Карточка документа (stage 10): контент и подписи — только double-stache
// (текстовое экранирование); ссылка скачивания рождается исключительно в
// safety.ts — небезопасный file_id деградирует в карточку без ссылки.

import Block from '../../../core/Block.ts'
import { documentDownloadUrl } from '../safety.ts'
import template from './document-card.hbs'

interface DocumentCardProps {
    fileId: unknown
    title: string
    snippet: string
    [key: string]: unknown
}

export class DocumentCard extends Block {
    constructor(props: DocumentCardProps) {
        let href = ''

        try {
            href = documentDownloadUrl(props.fileId)
        } catch {
            // небезопасный file_id — карточка деградирует без ссылки
        }

        super({ ...props, href, hasFile: href !== '' })
    }

    render() {
        return this.compile(template, this.props)
    }
}
