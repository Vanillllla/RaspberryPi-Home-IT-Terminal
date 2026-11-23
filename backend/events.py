"""Committed state invalidations for clients of a single FastAPI process."""
import asyncio
import json
from threading import Lock

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

router = APIRouter()
HISTORY = 512
_subscribers = set()
_lock = Lock()
_presence = {}


def visible(widget_id):
    with _lock:
        return any(widget_id in ids for ids in _presence.values())


def notify_committed():
    with _lock:
        for loop, ready in _subscribers:
            try:
                loop.call_soon_threadsafe(ready.set)
            except RuntimeError:
                if not loop.is_closed():
                    raise


def read_events(after=None):
    from .storage import database, state_revision

    with database() as conn:
        revision = state_revision(conn)
        if after is None or not 0 <= revision - after <= HISTORY:
            return {"type": "ready", "revision": revision}
        changes = {}
        for row in conn.execute("SELECT changes FROM state_events WHERE revision>? ORDER BY revision", (after,)):
            for change in json.loads(row["changes"]):
                changes[(change["kind"], change.get("id"))] = change
        return {"type": "changes", "revision": revision, "changes": list(changes.values())}


async def receive_presence(socket):
    while True:
        message = await socket.receive()
        if message["type"] == "websocket.disconnect":
            return
        try:
            data = json.loads(message.get("text", ""))
            ids = data["visible"]
            if isinstance(ids, list) and len(ids) <= 4096 and all(type(i) is int for i in ids):
                with _lock:
                    _presence[socket] = set(ids)
        except (ValueError, KeyError, TypeError):
            continue


@router.websocket("/api/events")
async def events(socket: WebSocket):
    await socket.accept()
    ready = asyncio.Event()
    subscriber = asyncio.get_running_loop(), ready
    with _lock:
        _subscribers.add(subscriber)
    receiver = asyncio.create_task(receive_presence(socket))
    cursor = None
    try:
        while not receiver.done():
            ready.clear()
            event = await run_in_threadpool(read_events, cursor)
            cursor = event["revision"]
            await socket.send_json(event)
            wake = asyncio.create_task(ready.wait())
            try:
                await asyncio.wait((receiver, wake), timeout=15, return_when=asyncio.FIRST_COMPLETED)
            finally:
                wake.cancel()
    except (WebSocketDisconnect, OSError):
        pass
    finally:
        with _lock:
            _subscribers.discard(subscriber)
            _presence.pop(socket, None)
        receiver.cancel()
        await asyncio.gather(receiver, return_exceptions=True)
