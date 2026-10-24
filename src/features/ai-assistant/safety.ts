// Единственное место рождения URL документов (stage 10): путь скачивания
// строится исключительно из положительного целого file_id и настроенного
// базиса через joinUrl (который отвергает чужие схемы, креды и traversal).
// javascript:, data: и произвольные origin'ы структурно невозможны.

import { type AppEnvironment, env, joinUrl } from '../../utils/env.ts'

export class UnsafeDocumentUrlError extends Error {
    readonly code = 'AI_UNSAFE_DOCUMENT_URL'

    constructor(rawFileId: unknown) {
        super(`file_id должен быть положительным целым числом, получено: ${String(rawFileId)}`)
        this.name = 'UnsafeDocumentUrlError'
    }
}

export function documentDownloadUrl(rawFileId: unknown, configuration: AppEnvironment = env): string {
    if (typeof rawFileId !== 'number' || !Number.isInteger(rawFileId) || rawFileId <= 0) {
        throw new UnsafeDocumentUrlError(rawFileId)
    }

    return joinUrl(configuration.apiUrl, `files/${rawFileId}/download`)
}
