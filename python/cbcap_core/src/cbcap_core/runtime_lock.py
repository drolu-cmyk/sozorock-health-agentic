from __future__ import annotations

from .persistence import ConnectionLike


def lock_county_run_identity(
    connection: ConnectionLike,
    *,
    tenant_id: str,
    run_id: str,
) -> None:
    """Serialize mutating operations for one immutable county run.

    The caller must authenticate the principal before reaching this function.
    The row lock is transaction-scoped, so it is released automatically on
    commit or rollback. A waiting request re-reads canonical state only after
    the prior mutation has finished, which prevents duplicate graph execution
    and review/execute races without a mutable application lock table.
    """

    tenant_id = tenant_id.strip()
    run_id = run_id.strip()
    if not tenant_id or not run_id:
        raise ValueError("tenant_id and run_id are required for a county run lock")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT run_id
              FROM cbcap.county_run_identity
             WHERE tenant_id=%s AND run_id=%s
             FOR UPDATE
            """,
            (tenant_id, run_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise LookupError("county run is unavailable in the active tenant scope")
