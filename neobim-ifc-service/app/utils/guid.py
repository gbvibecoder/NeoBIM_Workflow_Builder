"""IFC GlobalId generation using UUID → 22-char base64 encoding."""

import uuid

# IFC base64 alphabet (different from standard base64)
_IFC_B64 = (
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "_$"
)


def new_guid() -> str:
    """Generate a new IFC-compliant 22-character GlobalId from a random UUID."""
    return _uuid_to_ifc_guid(uuid.uuid4())


def _uuid_to_ifc_guid(u: uuid.UUID) -> str:
    """Convert a UUID to a 22-character IFC GlobalId (base64 encoded)."""
    n = u.int
    chars = []
    for _ in range(22):
        chars.append(_IFC_B64[n % 64])
        n //= 64
    return "".join(reversed(chars))
