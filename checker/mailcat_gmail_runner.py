#!/usr/bin/env python3
import asyncio, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'checker' / 'mailcat'))
sys.path.insert(0, str(ROOT / 'checker' / 'mailcat' / 'src'))
from mailcat import gmail, AsyncioProgressbarQueueExecutor, simple_session, _open_sessions

async def main():
    payload = json.load(sys.stdin)
    emails = payload.get('emails', [])
    timeout = max(2, min(int(payload.get('timeout', 10)), 20))
    parallel = max(1, min(int(payload.get('parallel', 10)), 20))
    results = []

    async def check(email):
        local = email.split('@', 1)[0]
        try:
            data = await gmail(local, simple_session, timeout=timeout)
            found, err = data if isinstance(data, tuple) else (data, '')
            if found and found.get('Google'):
                return {'email': email, 'status': 'SMTP_ACCEPTED', 'provider': 'Google', 'matches': found['Google']}
            if err:
                return {'email': email, 'status': 'UNKNOWN', 'reason': str(err)}
            return {'email': email, 'status': 'SMTP_REJECTED', 'reason': 'Server Gmail tidak menerima alamat pada tahap RCPT TO.'}
        except Exception as exc:
            return {'email': email, 'status': 'UNKNOWN', 'reason': str(exc)}

    # Keep the concurrency model from Mailcat's executor while returning structured data.
    tasks = []
    for email in emails:
        tasks.append((check, [email], {}))

    class QuietProgress:
        def __init__(self, total): pass
        def update(self, *args, **kwargs): pass
        def close(self, *args, **kwargs): pass

    executor = AsyncioProgressbarQueueExecutor(
        logger=__import__('logging').getLogger('mailcat'),
        in_parallel=parallel,
        timeout=timeout + 1,
        progress_func=QuietProgress,
    )
    raw = await executor.run(tasks)
    results.extend(raw)

    for session in list(_open_sessions):
        try:
            if hasattr(session, 'closed') and session.closed:
                continue
            await session.close()
        except Exception:
            pass
    _open_sessions.clear()
    print(json.dumps({'ok': True, 'results': results}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}))
        raise
