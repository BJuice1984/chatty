import { expect } from 'chai'
import type { AiDocumentChunk } from './ports.ts'
import { RAG_RELEVANT_MIN_SCORE, toDocumentHits } from './documents.ts'

function chunk(overrides: Partial<AiDocumentChunk>): AiDocumentChunk {
    return {
        document_id: 1,
        content: 'текст чанка',
        score: 0.7,
        file_id: 5,
        file_name: 'файл.pdf',
        ...overrides,
    } as AiDocumentChunk
}

describe('ai assistant document hits', () => {
    it('filters out chunks below the relevance threshold (irrelevant question → empty list)', () => {
        const hits = toDocumentHits([
            chunk({ score: 0.41, file_name: 'график отпусков 2026.xlsx', file_id: 7 }),
            chunk({ score: 0.38, file_name: 'заявление на аванс.docx', file_id: 8 }),
        ])

        expect(hits).to.deep.equal([])
        expect(RAG_RELEVANT_MIN_SCORE).to.equal(0.5)
    })

    it('keeps relevant chunks and deduplicates by file keeping the best-score entry name', () => {
        const hits = toDocumentHits([
            chunk({ score: 0.67, file_id: 5, file_name: 'заявление на отпуск.docx' }),
            chunk({ score: 0.62, file_id: 5, file_name: 'заявление на отпуск.docx' }),
            chunk({ score: 0.58, file_id: 6, file_name: 'бюджет 2026.xlsx' }),
        ])

        expect(hits.map(hit => hit.name)).to.deep.equal([
            'заявление на отпуск.docx',
            'бюджет 2026.xlsx',
        ])
        expect(hits[0].url).to.match(/\/files\/5\/download$/)
        expect(hits[1].url).to.match(/\/files\/6\/download$/)
    })

    it('falls back to the document id title and honors a custom threshold', () => {
        const hits = toDocumentHits([
            chunk({ score: 0.55, file_id: 9, file_name: '' }),
        ], 0.6)

        expect(hits).to.deep.equal([])

        const kept = toDocumentHits([
            chunk({ score: 0.65, file_id: 9, file_name: '', document_id: 42 }),
        ], 0.6)

        expect(kept[0].name).to.equal('Документ #42')
    })
})
