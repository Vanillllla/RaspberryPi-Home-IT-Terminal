"""Single-process, visibility-aware periodic work. No timer is owned by a browser."""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

from . import catalog, runtime, storage


def plans():
    result = {}
    with storage.database() as conn:
        for row in conn.execute("SELECT id, project_id, desktop_id, execution FROM widgets ORDER BY id"):
            definition = catalog.projects.get(row["project_id"])
            if definition and runtime.should_tick(row, definition):
                run = runtime.effective_execution(row, definition)
                result[row["id"]] = (definition.revision, run["interval"], run["mode"])
    return result


def tick(widget_id):
    try:
        runtime.dispatch(widget_id, runtime.Event(name="tick"), periodic=True)
    except HTTPException:
        pass  # Instance errors are recorded by dispatch. Deletions are benign.
    except Exception:
        logging.getLogger(__name__).exception("Periodic handler failed for %d", widget_id)


async def run(stop):
    loop = asyncio.get_running_loop()
    pending = {}
    deadlines = {}
    signatures = {}
    pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="widget-tick")
    try:
        while not stop.is_set():
            active = await asyncio.to_thread(plans)
            now = loop.time()
            for key, future in list(pending.items()):
                if future.done():
                    future.result()
                    del pending[key]
            for key in signatures.keys() - active.keys():
                deadlines.pop(key, None)
            for key, signature in active.items():
                if signature != signatures.get(key):
                    deadlines[key] = now
            signatures = active
            for key in sorted(active, key=deadlines.get):
                if len(pending) >= 3:
                    break
                if key not in pending and deadlines[key] <= now:
                    pending[key] = loop.run_in_executor(pool, tick, key)
                    deadlines[key] = now + active[key][1]
            try:
                await asyncio.wait_for(stop.wait(), timeout=.25)
            except TimeoutError:
                pass
    finally:
        await asyncio.gather(*pending.values(), return_exceptions=True)
        pool.shutdown()
