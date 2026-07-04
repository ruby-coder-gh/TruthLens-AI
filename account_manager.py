import os
import json
import time
from datetime import datetime, timedelta
import base64

# File to store account states locally
CONFIG_FILE = "accounts_db.json"

class AccountManager:
    def __init__(self):
        self.accounts = {}
        self.active_account = None
        self.auto_switch = True
        self.load_data()

    def load_data(self):
        """Loads accounts from local JSON, decoding credentials."""
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    self.active_account = data.get("active_account")
                    self.auto_switch = data.get("auto_switch", True)

                    # Decode credentials
                    for name, acc in data.get("accounts", {}).items():
                        acc["user_id"] = base64.b64decode(acc["user_id"].encode()).decode()
                        acc["password"] = base64.b64decode(acc["password"].encode()).decode()
                        self.accounts[name] = acc
            except Exception as e:
                print(f"Error loading config: {e}")
        else:
            # Pre-seed with two example accounts using ID/Password pairs
            self.accounts = {
                "Personal-1": {"user_id": "alex@email.com", "password": "password123", "session_pct": 80, "weekly_pct": 52, "status": "healthy", "reset_time": None},
                "Personal-2": {"user_id": "sam@email.com", "password": "securepass456", "session_pct": 100, "weekly_pct": 94, "status": "healthy", "reset_time": None}
            }
            self.active_account = "Personal-1"
            self.save_data()

    def save_data(self):
        """Saves accounts to local JSON, obfuscating credentials."""
        data = {
            "active_account": self.active_account,
            "auto_switch": self.auto_switch,
            "accounts": {}
        }
        for name, acc in self.accounts.items():
            acc_copy = acc.copy()
            # Obfuscate ID and Password before saving
            acc_copy["user_id"] = base64.b64encode(acc_copy["user_id"].encode()).decode()
            acc_copy["password"] = base64.b64encode(acc_copy["password"].encode()).decode()
            data["accounts"][name] = acc_copy

        with open(CONFIG_FILE, 'w') as f:
            json.dump(data, f, indent=4)

    def draw_progress_bar(self, percentage):
        """Generates an ASCII progress bar."""
        blocks = int(percentage / 10)
        return ("█" * blocks) + ("░" * (10 - blocks))

    def format_time_remaining(self, iso_string):
        if not iso_string: return ""
        reset_time = datetime.fromisoformat(iso_string)
        now = datetime.now()
        if reset_time <= now:
            return "Ready"
        diff = reset_time - now
        return f"{diff.days}d {diff.seconds // 3600}h"

    def cmd_list(self):
        """Renders the dashboard UI showing total account metrics."""
        total_accounts = len(self.accounts)

        print("\n" + "═" * 30)
        print(" /ACCOUNT DASHBOARD")
        print(f" Total Accounts Configured: {total_accounts}")
        print(f" Active Target: {self.active_account or 'None'}")
        print("═" * 30 + "\n")

        if total_accounts == 0:
            print(" No accounts added yet. Use '/account login' to add one.")
        else:
            for name, acc in self.accounts.items():
                if acc["status"] == "healthy":
                    icon = "✓"
                    status_text = f"{self.draw_progress_bar(acc['session_pct'])} {acc['session_pct']}%"
                elif acc["status"] == "warning":
                    icon = "⚠"
                    status_text = f"{self.draw_progress_bar(acc['session_pct'])} {acc['session_pct']}%"
                else:
                    icon = "✗"
                    status_text = f"Weekly Reset | {self.format_time_remaining(acc['reset_time'])}"

                print(f"{icon} {name} ({acc['user_id']})")
                print(f"  {status_text}\n")

        print("─" * 30)
        print(f"Auto Switch Mode: {'ON' if self.auto_switch else 'OFF'}")
        print("─" * 30)

    def cmd_switch(self, account_name):
        if account_name in self.accounts:
            self.active_account = account_name
            self.save_data()
            print(f"[+] Switched active context to: {account_name}")
        else:
            print(f"[X] Error: Account '{account_name}' does not exist.")

    def cmd_auto(self, state_str):
        if state_str.lower() == "on":
            self.auto_switch = True
        elif state_str.lower() == "off":
            self.auto_switch = False
        self.save_data()
        print(f"[+] Auto Switch capability set to: {'ON' if self.auto_switch else 'OFF'}")

    def cmd_set(self, account_name, field, value):
        if account_name not in self.accounts:
            print(f"[X] Error: Account '{account_name}' does not exist.")
            return
        if field not in ["session_pct", "weekly_pct", "status"]:
            print(f"[X] Error: Field '{field}' not valid. Use: session_pct, weekly_pct, status")
            return
        try:
            if field in ["session_pct", "weekly_pct"]:
                value = int(value)
                if value < 0 or value > 100:
                    print("[X] Error: Value must be between 0 and 100")
                    return
            self.accounts[account_name][field] = value
            self.save_data()
            print(f"[+] Set {account_name}.{field} = {value}")
        except ValueError:
            print(f"[X] Error: Value must be an integer for {field}")

    def cmd_reset(self, account_name):
        if account_name not in self.accounts:
            print(f"[X] Error: Account '{account_name}' does not exist.")
            return
        self.accounts[account_name] = {
            "user_id": self.accounts[account_name]["user_id"],
            "password": self.accounts[account_name]["password"],
            "session_pct": 100,
            "weekly_pct": 100,
            "status": "healthy",
            "reset_time": None
        }
        self.save_data()
        print(f"[+] Reset account '{account_name}' to healthy state")

    def cmd_login(self, account_name, user_id, password):
        """Adds a new account configuration using user ID and Password."""
        self.accounts[account_name] = {
            "user_id": user_id,
            "password": password,
            "session_pct": 100,
            "weekly_pct": 100,
            "status": "healthy",
            "reset_time": None
        }
        if not self.active_account:
            self.active_account = account_name
        self.save_data()
        print(f"\n[+] Successfully registered '{account_name}'")
        print(f"    User ID: {user_id}")
        print(f"    Current Pool Size: {len(self.accounts)} accounts")

    def failover_routine(self):
        print(f"[!] Rate limit hit on {self.active_account}. Finding next available login...")
        self.accounts[self.active_account]["status"] = "exhausted"
        self.accounts[self.active_account]["session_pct"] = 0
        self.accounts[self.active_account]["reset_time"] = (datetime.now() + timedelta(hours=4)).isoformat()

        available = {k: v for k, v in self.accounts.items() if v["status"] in ["healthy", "warning"]}

        if not available:
            print("[X] Critical Fail: All available accounts have hit their limit targets.")
            self.save_data()
            return False

        next_account = sorted(available.items(), key=lambda x: x[1]["session_pct"], reverse=True)[0][0]
        self.active_account = next_account
        self.save_data()
        print(f"[+] Failover complete. Now executing with: {next_account} ({self.accounts[next_account]['user_id']})")
        return True

    def simulate_request(self):
        if not self.active_account:
            print("[X] Error: Cannot execute request. No accounts configured.")
            return
        print(f"\n[HTTP POST] Initiating request using ID: {self.accounts[self.active_account]['user_id']}...")
        time.sleep(0.8)
        print("API Response status: 429 - Rate Limit / Quota Exceeded")

        if self.auto_switch:
            if self.failover_routine():
                print("Retrying context call...")
                time.sleep(0.8)
                print(f"API Response status: 200 OK (Processed successfully via backend update)")
        else:
            print("[!] Auto-switch disabled. Request halted.")


def main():
    manager = AccountManager()
    print("═" * 50)
    print(" Account Manager Console Loaded.")
    print(" Commands: list | switch | login | auto | simulate | set | reset | exit | help")
    print("═" * 50)

    while True:
        try:
            user_input = input("\n/account ").strip().split()
            if not user_input:
                continue

            command = user_input[0].lower()
            args = user_input[1:]

            if command in ['exit', 'quit']:
                break
            elif command == 'list':
                manager.cmd_list()
            elif command == 'switch' and len(args) == 1:
                manager.cmd_switch(args[0])
            elif command == 'auto' and len(args) == 1:
                manager.cmd_auto(args[0])
            elif command == 'login' and len(args) == 3:
                manager.cmd_login(args[0], args[1], args[2])
            elif command == 'simulate':
                manager.simulate_request()
            elif command == 'set' and len(args) == 3:
                manager.cmd_set(args[0], args[1], args[2])
            elif command == 'reset' and len(args) == 1:
                manager.cmd_reset(args[0])
            elif command == 'help':
                print("Usage commands:")
                print("  list                       - Show dashboard display and account counts")
                print("  switch <name>              - Change active account focus")
                print("  auto <on/off>              - Toggle automatic exception failover")
                print("  login <name> <id> <pass>   - Register new account profile into storage")
                print("  simulate                   - Run a mock request to trigger auto-failover")
                print("  set <account> <field> <value> - Set field (session_pct, weekly_pct, status) for account")
                print("  reset <account>            - Reset account to healthy state (session_pct=100, weekly_pct=100, status=healthy)")
            else:
                print("Command sequence not recognized or argument counts mismatched. Type 'help'.")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"Execution handling error: {e}")

if __name__ == "__main__":
    main()