import sqlite3
import logging
import os
from datetime import datetime, timedelta
import httpx

DB_PATH = os.getenv('DB_PATH', './state.db')
OLLAMA_API_BASE = os.getenv('OLLAMA_API_BASE', 'http://localhost:11434')
logger = logging.getLogger(__name__)

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            token TEXT NOT NULL,
            session_pct INTEGER DEFAULT 100,
            weekly_pct INTEGER DEFAULT 100,
            status TEXT DEFAULT 'healthy',
            requests_today INTEGER DEFAULT 0,
            weekly_requests INTEGER DEFAULT 0,
            last_used TEXT,
            blocked_until TEXT
        )
    ''')
    conn.commit()
    conn.close()
    logger.info('Database initialized')

def insert_initial_accounts():
    # Accounts from user message: email:password pairs
    accounts = [
        ("nvghasiya621@gmail.com", "Test@123"),
        ("marilynmitchelle6.1.2.5.7@gmail.com", "Test@123"),
        ("emmalyngille.s.pie0.6.9@gmail.com", "Test@123")
    ]
    conn = get_connection()
    c = conn.cursor()
    for name, token in accounts:
        try:
            c.execute('''
                INSERT OR IGNORE INTO accounts (name, token, session_pct, weekly_pct, status)
                VALUES (?, ?, 100, 100, 'healthy')
            ''', (name, token))
        except Exception as e:
            logger.error(f"Failed to insert account {name}: {e}")
    conn.commit()
    conn.close()
    logger.info('Initial accounts inserted')

def get_healthy_accounts():
    conn = get_connection()
    c = conn.cursor()
    now = datetime.utcnow().isoformat()
    c.execute('''
        SELECT id, name, token, session_pct, weekly_pct, status,
               requests_today, weekly_requests, last_used, blocked_until
        FROM accounts
        WHERE (status = 'healthy' OR status = 'exhausted')
          AND (blocked_until IS NULL OR blocked_until < ?)
    ''', (now,))
    rows = c.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def increment_usage(acc_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute('''
        UPDATE accounts
        SET requests_today = requests_today + 1,
            weekly_requests = weekly_requests + 1,
            last_used = ?
        WHERE id = ?
    ''', (datetime.utcnow().isoformat(), acc_id))
    conn.commit()
    conn.close()

def set_account_status(acc_id, status, blocked_until=None):
    conn = get_connection()
    c = conn.cursor()
    if blocked_until is None:
        c.execute('UPDATE accounts SET status=? WHERE id=?', (status, acc_id))
    else:
        c.execute('UPDATE accounts SET status=?, blocked_until=? WHERE id=?', (status, blocked_until, acc_id))
    conn.commit()
    conn.close()

def select_account():
    """Select an account using priority: highest session_pct, lowest requests_today."""
    accounts = get_healthy_accounts()
    if not accounts:
        return None
    # sort by session_pct desc, requests_today asc
    accounts.sort(key=lambda a: (-a.get('session_pct', 0), a.get('requests_today', 0)))
    chosen = accounts[0]
    increment_usage(chosen['id'])
    return chosen

def health_check_account(acc):
    """Probe Ollama with token; update status based on response."""
    token = acc['token']
    headers = {'Authorization': f'Bearer {token}'}
    try:
        resp = httpx.get(f'{OLLAMA_API_BASE}/api/tags', headers=headers, timeout=10.0)
        if resp.status_code == 200:
            set_account_status(acc['id'], 'healthy')
            # Optionally update session_pct based on some header? Not provided.
            return True
        elif resp.status_code == 429:
            # rate limited -> block for 1 hour
            blocked = (datetime.utcnow() + timedelta(hours=1)).isoformat()
            set_account_status(acc['id'], 'exhausted', blocked)
            logger.warning(f"Account {acc['name']} rate limited (429)")
            return False
        else:
            set_account_status(acc['id'], 'unhealthy')
            logger.warning(f"Account {acc['name']} unhealthy: {resp.status_code}")
            return False
    except Exception as e:
        set_account_status(acc['id'], 'unhealthy')
        logger.warning(f"Account {acc['name']} health check failed: {e}")
        return False

def reset_daily():
    conn = get_connection()
    c = conn.cursor()
    c.execute('UPDATE accounts SET requests_today = 0')
    conn.commit()
    conn.close()
    logger.info('Daily request counters reset')

def reset_weekly():
    conn = get_connection()
    c = conn.cursor()
    c.execute('UPDATE accounts SET weekly_requests = 0')
    conn.commit()
    conn.close()
    logger.info('Weekly request counters reset')