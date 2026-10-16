//Валидация
export const loginValidationMessage =
    'от 3 до 20 символов, латиница, может содержать цифры, но не состоять из них, без пробелов, без спецсимволов (допустимы дефис и нижнее подчёркивание)'
export const passwordValidationMessage =
    'от 12 до 40 символов, обязательно хотя бы одна заглавная буква и цифра'
export const phoneValidationMessage =
    'Tелефон в формате 8(ХХХ)ХХХ-ХХХХ. от 10 до 15 символов, состоит из цифр, может начинается с плюса'
export const nameValidationMessage =
    'латиница или кириллица, первая буква должна быть заглавной, без пробелов и без цифр, нет спецсимволов (допустим только дефис)'
export const mailValidationMessage = 'EMail в формате user@usermail.ru'
export const emptyValidationMessage = 'Поле не может быть пустым'

//Маршруты
export const SIGNIN = '/'
export const SIGNUP = '/sign-up'
export const PROFILE = '/settings'
export const MESSENGER = '/messenger'
