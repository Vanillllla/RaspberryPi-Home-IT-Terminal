from contextvars import ContextVar

language = ContextVar("language", default="ru")


def tr(russian: str, english: str) -> str:
    return english if language.get() == "en" else russian


VALIDATION_RUSSIAN = {
    "missing": "обязательное поле отсутствует",
    "json_invalid": "некорректный JSON",
    "string_type": "ожидается строка",
    "int_type": "ожидается целое число",
    "float_type": "ожидается число",
    "bool_type": "ожидается логическое значение",
    "list_type": "ожидается список",
    "dict_type": "ожидается объект",
    "model_type": "ожидается объект",
    "literal_error": "допустимые значения: {expected}",
    "string_pattern_mismatch": "значение должно соответствовать шаблону {pattern}",
    "string_too_short": "минимальная длина строки: {min_length}",
    "string_too_long": "максимальная длина строки: {max_length}",
    "too_short": "минимальное число элементов: {min_length}",
    "too_long": "максимальное число элементов: {max_length}",
    "greater_than": "значение должно быть больше {gt}",
    "greater_than_equal": "значение должно быть не меньше {ge}",
    "less_than_equal": "значение должно быть не больше {le}",
    "finite_number": "ожидается конечное число",
    "uuid_parsing": "некорректный UUID",
    "int_parsing": "некорректное целое число",
    "float_parsing": "некорректное число",
    "bool_parsing": "некорректное логическое значение",
}


def validation_message(issue):
    russian = VALIDATION_RUSSIAN.get(issue["type"], "недопустимое значение")
    return tr(russian.format(**issue.get("ctx", {})), issue["msg"])
