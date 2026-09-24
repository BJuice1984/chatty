[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![Netlify Status](https://api.netlify.com/api/v1/badges/88434455-8cb0-47c4-bae9-b763d88135f9/deploy-status?branch=deploy)](https://app.netlify.com/sites/startling-faloodeh-01b44f/deploys)
<h1 align="center">Веб-приложение для общения "Chatty"</h1>

## О проекте
Проект написан на TypeScript с использованием шаблонизатора HandleBars абсолютно без сторонних библиотек. Использована архитектура MVC (Model-View-Controller), реализованы паттерны Block и EventBus. Это многостраничное приложение. Для запуска проекта введите в редакторе кода **npm run dev** либо перейдите по ссылке ниже. Реализован роутинг на собственном комопненте Route.ts. Все запросы на сервер реализованы с помощью XMLHttpRequest. Для получения и отправки сообщений в чате реализовано подключение по WebSokets.

## Возможности и технологии чата
- Работа с API чата (создавние чата, удаление чата, добавление пользователей в чат, отправка сообщений)
- Валидация полей полей форм на страницах авторизации, регистрации, настроек прфиля по событиям `blur`, `focus`, `submit`
- Авторизация, регистрация и изменение профиля пользователя
- Класс `WSTransport` для отправки сообщение в режиме реального времени (WebSocket)
- Класс `HTTPTransport` для взаимодействия с API (HTTPS)
- В проекте используется компонентный подход, написанный на `TypeScript`
- Написаны тесты для блока, роутера, компонента, модуля отправки запросов **HTTPTransport** и комопнентов **Button** и **Input**.

## Установка
1. Создайте папку папку **Chatty**
2. Склонируйте репозитарий с помощью `git clone https://github.com/BJuice1984/chatty.git` в папку **chatty**;
3. Перейдите в папку **Chatty**;
4. В терминале введите команду `npm i`;
5. Дождитесь окончания установки всех зависимостей;
6. В терминале введите команду `npm run start` и приложение автоматически откроется в браузере на порту 3000;
7. Для создания сборки введите команду `npm run build`, после чего в папке **build** появятся все необходимые файлы;
8. Для тестирования введите команду `npm run test`.

## Доработки
- Настроить **ProtectedRoute** для /messenger. На данный момент, можно перейти на этот маршрут незаваисимо от аутентификации;
- Реализовать загрузку и отправку файлов в чате;
- Сделать адаптивную вёрстку для tablet и mobile;
- Сделать цветовые схемы "Светлая" и "Тёмная";
- Поправить вёрстку некоторых комопнентов и привести их к дизайн-макету;
- Исправить работу модальных окон;

## Используемый стек
![TS](https://img.shields.io/badge/typescript%20-%23007ACC.svg?&style=for-the-badge&logo=typescript&logoColor=white)
![SASS](https://img.shields.io/badge/SASS%20-hotpink.svg?&style=for-the-badge&logo=SASS&logoColor=white)
![HandleBars](https://img.shields.io/badge/Handlebars-23272f?style=for-the-badge&logo=handlebarsdotjs)
![Vite](https://img.shields.io/badge/Vite-23272f?style=for-the-badge&logo=vite)
![Netlify](https://img.shields.io/badge/netlify-%23000000.svg?style=for-the-badge&logo=netlify&logoColor=#00C7B7)
![Mocha](https://img.shields.io/badge/mocha.js-323330?style=for-the-badge&logo=mocha&logoColor=Brown)
![Chai](https://img.shields.io/badge/chai.js-323330?style=for-the-badge&logo=chai&logoColor=red)

## [Ссылка на проект](https://deploy-preview-5--startling-faloodeh-01b44f.netlify.app/)
## [Ссылка на макет Figma](https://www.figma.com/file/bM8yGd4zQLl4H7VQSThAma/Chatty-UI-Kit---Messenger-App?type=design&node-id=0%3A1&mode=design&t=S96tosRx5QfhpWsh-1)

## Автор

[Ильяс Сибгатуллин](https://github.com/BJuice1984): [i.sibgatullin59@gmail.com](i.sibgatullin59@gmail.com)
