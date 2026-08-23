import pytest

from cbcap_core.runtime_lock import lock_county_run_identity

TENANT = "tenant:albany-planning"
RUN = "run:lock:36001"


class Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.executions.append((normalized, params))
        if normalized.startswith("SELECT run_id"):
            self.row = self.connection.row

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, row=(RUN,)):
        self.row = row
        self.executions = []

    def cursor(self):
        return Cursor(self)


def test_county_run_lock_is_transaction_scoped_bounded_and_tenant_specific():
    connection = Connection()
    lock_county_run_identity(connection, tenant_id=TENANT, run_id=RUN)

    assert connection.executions[0] == ("SET LOCAL lock_timeout = '5s'", None)
    query, params = connection.executions[1]
    assert "FROM cbcap.county_run_identity" in query
    assert "WHERE tenant_id=%s AND run_id=%s" in query
    assert "FOR UPDATE" in query
    assert params == (TENANT, RUN)


def test_county_run_lock_fails_closed_when_run_is_not_visible_in_tenant_scope():
    with pytest.raises(LookupError, match="active tenant scope"):
        lock_county_run_identity(Connection(row=None), tenant_id=TENANT, run_id=RUN)


@pytest.mark.parametrize("tenant_id,run_id", [("", RUN), (TENANT, ""), ("  ", RUN), (TENANT, "  ")])
def test_county_run_lock_rejects_blank_scope(tenant_id, run_id):
    connection = Connection()
    with pytest.raises(ValueError, match="required"):
        lock_county_run_identity(connection, tenant_id=tenant_id, run_id=run_id)
    assert connection.executions == []
