use anyhow::Result;
use bte_coordinator::{api, db, engine, state};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://bte.db".to_string());
    let conn = db::open(&db::path_from_url(&db_url))?;
    let app = state::App::new(conn, state::Config::from_env())?;

    // Dev convenience: BTE_DEV=1 + a params file path auto-registers it.
    if let Ok(path) = std::env::var("BTE_PARAMS_FILE") {
        let blob = std::fs::read(&path)?;
        let id = app.register_committee(&blob)?;
        info!(
            committee = id,
            path, "registered committee from BTE_PARAMS_FILE"
        );
    }

    let engine_app = app.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
        loop {
            interval.tick().await;
            if let Err(e) = engine::tick(&engine_app).await {
                tracing::error!(error = %e, "engine tick failed");
            }
        }
    });

    let addr = std::env::var("BTE_LISTEN").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(%addr, "bte-coordinator listening");
    axum::serve(
        listener,
        api::router(app).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
