from server.models.lorebook import LorebookActivationEvent
from test_resource_security import lorebook_api, resource_graph


def test_owner_can_update_advanced_settings(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}",
        json={
            "token_budget": 800,
            "recursive_scan": True,
            "max_recursion_steps": 5,
            "is_character_default": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["token_budget"] == 800
    assert response.json()["is_character_default"] is False


def test_debug_trace_is_owned_and_does_not_persist_events(
    lorebook_api,
    resource_graph,
    db_session,
):
    response = lorebook_api.client.post(
        "/api/lorebooks/debug",
        json={"session_id": resource_graph.chat_session.id, "text": "shore"},
    )

    assert response.status_code == 200
    assert response.json()["activated_ids"] == [resource_graph.entry.id]
    assert db_session.query(LorebookActivationEvent).count() == 0


def test_advanced_values_are_bounded(lorebook_api, resource_graph):
    response = lorebook_api.client.post(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries",
        json={"keyword": "x", "content": "y", "sticky": -1},
    )

    assert response.status_code == 422


def test_owner_can_replace_chat_bindings(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}/bindings",
        json={"chat_session_ids": [resource_graph.chat_session.id]},
    )

    assert response.status_code == 200
    assert response.json()["chat_session_ids"] == [resource_graph.chat_session.id]


def test_binding_rejects_foreign_chat(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}/bindings",
        json={"chat_session_ids": [resource_graph.foreign_chat_session.id]},
    )

    assert response.status_code == 404


def test_prompt_change_increments_revision_exactly_once(
    lorebook_api,
    resource_graph,
):
    path = f"/api/lorebooks/entries/{resource_graph.entry.id}"
    changed = lorebook_api.client.put(path, json={"content": "New shores"})
    unchanged = lorebook_api.client.put(path, json={"content": "New shores"})

    assert changed.status_code == 200
    assert changed.json()["revision"] == 2
    assert unchanged.json()["revision"] == 2
