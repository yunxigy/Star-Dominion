from __future__ import annotations


def test_full_backup_round_trip_preserves_graph(db_session, seeded_chat, tmp_path):
    from server.services.chat_backups import ChatBackupService
    from server.services.chat_history import ChatHistoryService

    history = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    history.edit_message(
        seeded_chat.user_message.id,
        "分支问候",
        expected_version=1,
    )
    history.create_checkpoint(
        seeded_chat.session.id,
        "分支起点",
        None,
        expected_version=2,
    )

    backups = ChatBackupService(db_session, root=tmp_path)
    payload = backups.export_session(
        seeded_chat.session.id,
        owner_id=seeded_chat.user_id,
    )
    imported = backups.import_session(
        payload,
        owner_id=seeded_chat.user_id,
    )

    assert imported.branch_count == payload["branch_count"]
    assert imported.checkpoint_count == payload["checkpoint_count"]
    assert imported.message_count == payload["message_count"]


def test_automatic_snapshots_are_atomic_and_keep_latest_twenty(
    db_session,
    seeded_chat,
    tmp_path,
):
    from server.services.chat_backups import ChatBackupService

    backups = ChatBackupService(db_session, root=tmp_path)
    for version in range(1, 23):
        backups.snapshot_after_change(
            seeded_chat.session.id,
            owner_id=seeded_chat.user_id,
            version=version,
        )

    files = sorted(tmp_path.glob("*.json"))
    assert len(files) == 20
    assert not list(tmp_path.glob("*.tmp"))
    assert "-22-" in files[-1].name
