from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/restaurant"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 12
    cors_origins: str = "http://localhost:3111,http://127.0.0.1:3111"
    seed_demo_data: bool = True
    # Business timezone: used for "today" and for grouping sales by day/hour in reports
    timezone: str = "Asia/Karachi"
    admin_username: str = "admin"
    admin_password: str = "admin123"


settings = Settings()
