// Загрузка файлов (stage 4): поведение через пропсы — компонент не знает,
// кто обрабатывает загрузку (фича profile для аватара пользователя,
// фича chats для аватара чата).

import Block from '../../../core/Block.ts'
import template from './inputFile.hbs'

interface InputFileProps {
    name: string
    type: string
    extraClass: string
    // eslint-disable-next-line no-unused-vars
    onUserFile?: (data: FormData) => void
    // eslint-disable-next-line no-unused-vars
    onChatFile?: (data: FormData) => void
    [key: string]: unknown
}

export class InputFile extends Block<InputFileProps> {
    private formData: FormData

    constructor(props: InputFileProps) {
        super({
            ...props,
            events: {
                change: () => {
                    const fileInput = this.element as HTMLInputElement
                    const selectedFile = fileInput.files && fileInput.files[0]
                    const containsNumber = /\d/.test(fileInput.id)

                    if (selectedFile && fileInput.id === 'user') {
                        this.formData.append(props.name, selectedFile)
                        props.onUserFile?.(this.formData)
                        this.formData.delete(props.name)
                    } else if (selectedFile && containsNumber) {
                        this.formData.append(props.name, selectedFile)
                        this.formData.append('chatId', fileInput.id)
                        props.onChatFile?.(this.formData)
                        this.formData.delete(props.name)
                    }
                },
            },
        })
        this.formData = new FormData()
    }

    render() {
        return this.compile(template, this.props)
    }
}
