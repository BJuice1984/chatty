"""Case declension for the form header (AC-HEADER-CASES).

Regression: the header used to print the requisites verbatim in the
nominative — «от Инженер-программиста Сибгатуллина И.Р.» came out as
«от Инженер-программист Сибгатуллин И.Р.». The pins below cover the
real schedule corpus shapes plus the failure modes found while picking
the approach: case-ambiguous surname parses, best-parse-only phrase
inflection, capitalization/«ё» restoration, abbreviation and quote
protection, indeclinable hyphen heads.
"""

from __future__ import annotations

from app.vacations.forms.declension import (
    dative_addressee,
    decline_surname,
    genitive_full_name,
    genitive_position,
)


# --- surnames: the real corpus shapes --------------------------------------


def test_masculine_consonant_surnames_gain_a_or_u() -> None:
    assert decline_surname('Сибгатуллин', 'gent') == 'Сибгатуллина'
    assert decline_surname('Сибгатуллин', 'datv') == 'Сибгатуллину'
    assert decline_surname('Бобров', 'gent') == 'Боброва'
    assert decline_surname('Грасюк', 'datv') == 'Грасюку'
    assert decline_surname('Мацук', 'gent') == 'Мацука'


def test_adjectival_feminine_surnames_take_oy() -> None:
    assert decline_surname('Романова', 'gent') == 'Романовой'
    assert decline_surname('Арсеньева', 'gent') == 'Арсеньевой'
    assert decline_surname('Шипицына', 'datv') == 'Шипицыной'
    assert decline_surname('Повшедная', 'gent') == 'Повшедной'


def test_masculine_adjectival_surnames() -> None:
    assert decline_surname('Вербицкий', 'gent') == 'Вербицкого'
    assert decline_surname('Вербицкий', 'datv') == 'Вербицкому'
    assert decline_surname('Луговской', 'gent') == 'Луговского'
    assert decline_surname('Вырвинский', 'datv') == 'Вырвинскому'


def test_indeclinable_surnames_stay() -> None:
    assert decline_surname('Ерошенко', 'gent') == 'Ерошенко'
    assert decline_surname('Мельниченко', 'datv') == 'Мельниченко'
    assert decline_surname('Лакизо', 'gent') == 'Лакизо'


def test_noun_type_a_surnames() -> None:
    assert decline_surname('Белка', 'gent') == 'Белки'
    assert decline_surname('Белка', 'datv') == 'Белке'


def test_fleeting_vowel_ec_surnames() -> None:
    # беглая «е»: Чернобривец -> Чернобривца, не «Чернобривеца»
    assert decline_surname('Чернобривец', 'gent') == 'Чернобривца'
    assert decline_surname('Чернобривец', 'datv') == 'Чернобривцу'


def test_dictionary_ambiguity_does_not_stop_the_declension() -> None:
    # «Сямин» has no clean nominative best parse — the suffix table
    # still declines it; «Романов» parses best as an inanimate plural
    assert decline_surname('Сямин', 'gent') == 'Сямина'
    assert decline_surname('Романов', 'datv') == 'Романову'


def test_surname_case_and_yo_profile_are_kept() -> None:
    # the schedule writes «Журавлев» without «ё» — so must the header
    assert decline_surname('Журавлев', 'gent') == 'Журавлева'


# --- full name: surname declines, initials never ---------------------------


def test_full_name_declines_surname_only() -> None:
    assert genitive_full_name('Сибгатуллин И.Р.') == 'Сибгатуллина И.Р.'
    assert genitive_full_name('Вишневский О.Н.') == 'Вишневского О.Н.'
    assert genitive_full_name('Шипицына Н.С.') == 'Шипицыной Н.С.'
    assert genitive_full_name('Ерошенко Д.А.') == 'Ерошенко Д.А.'


# --- positions: genitive after «от» ----------------------------------------


def test_positions_decline_the_nominative_words_only() -> None:
    assert genitive_position('Инженер-программист') == 'Инженера-программиста'
    assert genitive_position('Финансовый менеджер') == 'Финансового менеджера'
    assert genitive_position('Менеджер по закупкам') == 'Менеджера по закупкам'
    assert genitive_position('Ведущий сетевой инженер') == 'Ведущего сетевого инженера'
    assert genitive_position('Ассистент отдела продаж') == 'Ассистента отдела продаж'
    assert genitive_position('Менеджер по упр. персоналом') == 'Менеджера по упр. персоналом'


def test_position_abbreviations_and_caps_stay() -> None:
    assert genitive_position('Вед. инженер-программист') == 'Вед. инженера-программиста'
    assert genitive_position('Вед.специалист по упр. персоналом') == 'Вед.специалиста по упр. персоналом'
    assert genitive_position('Начальник ОЗИ') == 'Начальника ОЗИ'
    assert genitive_position('Разработчик ПО') == 'Разработчика ПО'
    assert genitive_position('Руководитель отдела ИТ') == 'Руководителя отдела ИТ'


def test_position_capitalized_proper_noun_mid_phrase_stays() -> None:
    # «Линукс» is a proper noun, not the first word — it must not become «Линукса»
    assert genitive_position('Инженер-программист Линукс') == 'Инженера-программиста Линукс'


def test_position_hyphen_head_indeclinable() -> None:
    assert genitive_position('Офис-менеджер') == 'Офис-менеджера'


# --- addressee: dative, tolerant to already-declined input ------------------


def test_addressee_nominative_declines_to_dative() -> None:
    assert (
        dative_addressee('Заместитель генерального директора ООО «Крафттек» Киричук А.В.')
        == 'Заместителю генерального директора ООО «Крафттек» Киричуку А.В.'
    )
    assert (
        dative_addressee('Генеральный директор ООО «Ромашка»')
        == 'Генеральному директору ООО «Ромашка»'
    )


def test_addressee_already_dative_passes_through() -> None:
    assert dative_addressee('Смирнову А.А.') == 'Смирнову А.А.'
    assert (
        dative_addressee('Генеральному директору ООО «Тест-Организация»')
        == 'Генеральному директору ООО «Тест-Организация»'
    )


def test_addressee_person_name_mid_phrase_declines() -> None:
    assert (
        dative_addressee('Генеральный директор Иванов Иван Иванович')
        == 'Генеральному директору Иванову Ивану Ивановичу'
    )


def test_addressee_genitive_dependents_are_not_redeclined() -> None:
    # «директора» is a genitive singular that also reads as a dative-less
    # nominative plural — it must stay untouched, not become «директорам»
    assert (
        dative_addressee('Заместитель директора')
        == 'Заместителю директора'
    )
