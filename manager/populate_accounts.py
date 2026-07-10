import json
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'state.db')
ACCOUNTS_PATH = os.path.join(os.path.dirname(__file__), 'accounts.json')

def populate():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Clear old accounts? We'll just insert or ignore
    with open(ACCOUNTS_PATH) as f:
        accounts = json.load(f)
    for acc in accounts:
        c.execute('''
            INSERT OR IGNORE INTO accounts (name, token, status, session_pct, weekly_pct)
            VALUES (?, ?, 'healthy', 100, 100)
        ''', (acc['name'], acc['token']))
    conn.commit()
    conn.close()
    print('Accounts populated')

if __name__ == '__main__':
    populate()