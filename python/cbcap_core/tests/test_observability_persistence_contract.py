import inspect

from cbcap_core.observability import persist_node_telemetry, persist_run_telemetry


def test_run_telemetry_persistence_is_insert_only():
    source = inspect.getsource(persist_run_telemetry)
    assert "INSERT INTO cbcap.run_telemetry" in source
    assert "DO UPDATE" not in source.upper()
    assert "UPDATE cbcap.run_telemetry" not in source


def test_node_telemetry_persistence_is_insert_only():
    source = inspect.getsource(persist_node_telemetry)
    assert "INSERT INTO cbcap.node_telemetry_sample" in source
    assert "DO UPDATE" not in source.upper()
    assert "UPDATE cbcap.node_telemetry_sample" not in source
