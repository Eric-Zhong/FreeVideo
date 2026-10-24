"""The one rule for comparing a page's Origin protocol with the protocol the server saw."""


def effective_scheme(request, origin_scheme):
    """The protocol to compare an Origin with.

    A TLS-terminating proxy turns https into http before the request arrives. Only when the request carries a single
    X-Forwarded-Proto equal to the Origin's own protocol is that difference accepted; host and port are still compared
    by the caller, and no other forwarding header is read.
    """
    headers = request.headers
    forwarded = headers.getall('X-Forwarded-Proto', []) if hasattr(headers, 'getall') else [headers['X-Forwarded-Proto']] if 'X-Forwarded-Proto' in headers else []
    if (origin_scheme in ('http', 'https') and len(forwarded) == 1
            and forwarded[0].strip().lower() == origin_scheme):
        return origin_scheme
    return request.scheme
