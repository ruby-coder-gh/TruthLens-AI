import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'state.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # accounts table
    c.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            token TEXT,
            status TEXT DEFAULT 'healthy',
            session_pct INTEGER DEFAULT 100,
            weekly_pct INTEGER DEFAULT 100,
            requests_today INTEGER DEFAULT 0,
            weekly_requests INTEGER DEFAULT 0,
            last_used TEXT,
            blocked_until TEXT
        )
    ''')
    # reset daily stats each day (we will run a job)
    # For simplicity, we don't auto reset daily here; scheduler will call reset_daily()
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print('Database initialized')