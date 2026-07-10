from apscheduler.schedulers.background import BackgroundScheduler
from .auth import health_check_account, get_healthy_accounts, reset_daily, reset_weekly
import logging

logger = logging.getLogger(__name__)

def health_check_job():
    logger.info('Running health check for all accounts')
    accounts = get_healthy_accounts()
    for acc in accounts:
        health_check_account(acc)

def start_scheduler():
    scheduler = BackgroundScheduler()
    # health check every hour
    scheduler.add_job(health_check_job, 'interval', hours=1, id='health_check', replace_existing=True)
    # reset daily at midnight UTC
    scheduler.add_job(reset_daily, 'cron', hour=0, minute=0, id='reset_daily', replace_existing=True)
    # reset weekly on Monday 00:00 UTC
    scheduler.add_job(reset_weekly, 'cron', day_of_week='mon', hour=0, minute=0, id='reset_weekly', replace_existing=True)
    scheduler.start()
    logger.info('Scheduler started')
    return scheduler