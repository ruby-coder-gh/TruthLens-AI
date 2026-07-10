import logging
import uvicorn
from .proxy import app
from .auth import init_db, insert_initial_accounts
from .scheduler import start_scheduler
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def startup():
    init_db()
    insert_initial_accounts()
    scheduler = start_scheduler()
    logger.info("Application startup complete")
    return scheduler

if __name__ == "__main__":
    scheduler = startup()
    try:
        uvicorn.run("manager.proxy:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=False)
    except KeyboardInterrupt:
        scheduler.shutdown()