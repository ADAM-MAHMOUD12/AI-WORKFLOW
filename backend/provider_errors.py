def provider_http_error(status_code: int, provider_name: str) -> tuple[int, str]:
    if status_code == 401:
        return 502, f"مفتاح الاتصال بمزوّد «{provider_name}» غير صالح أو منتهي. راجع إعدادات المزوّد."
    if status_code == 402:
        return 402, f"مزوّد «{provider_name}» يطلب رصيدًا أو اشتراكًا صالحًا. أضف رصيدًا لدى المزوّد أو اختر مزوّدًا آخر."
    if status_code == 403:
        return 502, f"مزوّد «{provider_name}» لا يسمح بهذا النموذج أو الطلب. راجع صلاحيات الحساب وإعدادات المزوّد."
    if status_code == 404:
        return 502, f"لم يجد مزوّد «{provider_name}» النموذج أو المسار المطلوب. راجع اسم النموذج وعنوان API."
    if status_code == 429:
        return 429, f"تجاوزت حدّ الاستخدام لدى مزوّد «{provider_name}». انتظر قليلًا أو اختر مزوّدًا آخر."
    if status_code == 503:
        return 503, f"مزوّد «{provider_name}» غير متاح مؤقتًا (HTTP 503). انتظر قليلًا أو اختر مزوّدًا آخر من القائمة."
    if status_code >= 500:
        return 503, f"حدث عطل مؤقت لدى مزوّد «{provider_name}» (HTTP {status_code}). حاول مجددًا أو اختر مزوّدًا آخر."
    return 502, f"رفض مزوّد «{provider_name}» الطلب (HTTP {status_code}). راجع إعدادات المزوّد وحاول مجددًا."
