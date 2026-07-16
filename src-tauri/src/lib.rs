use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{Header, Headers, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const TIMEOUT: Duration = Duration::from_secs(6);
/// group used for read-only inspection (never commits, never joins)
const INSPECT_GROUP: &str = "kafkamin-inspect";
const PAYLOAD_CAP: usize = 32 * 1024;
const SEARCH_RESULT_CAP: usize = 10_000;

#[derive(Clone)]
struct SearchHandle {
    cancelled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

#[derive(Default)]
struct SearchRegistry(Mutex<HashMap<String, SearchHandle>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConnection {
    pub brokers: String,
    /// "plaintext" | "ssl" | "sasl_plaintext" | "sasl_ssl"
    pub security_protocol: String,
    /// "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512"
    #[serde(default)]
    pub sasl_mechanism: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

fn base_config(conn: &KafkaConnection) -> ClientConfig {
    let mut c = ClientConfig::new();
    c.set("bootstrap.servers", &conn.brokers);
    let proto = match conn.security_protocol.as_str() {
        "ssl" => "ssl",
        "sasl_plaintext" => "sasl_plaintext",
        "sasl_ssl" => "sasl_ssl",
        _ => "plaintext",
    };
    c.set("security.protocol", proto);
    if proto.starts_with("sasl") {
        c.set(
            "sasl.mechanisms",
            conn.sasl_mechanism.as_deref().unwrap_or("PLAIN"),
        );
        c.set("sasl.username", conn.username.as_deref().unwrap_or(""));
        c.set("sasl.password", conn.password.as_deref().unwrap_or(""));
    }
    // fail fast instead of hanging the UI on a dead broker
    c.set("socket.timeout.ms", "5000");
    c.set("api.version.request.timeout.ms", "5000");
    c
}

fn make_consumer(conn: &KafkaConnection, group: &str) -> Result<BaseConsumer, String> {
    let mut c = base_config(conn);
    c.set("group.id", group)
        .set("enable.auto.commit", "false")
        .set("enable.partition.eof", "false");
    c.create().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerInfo {
    pub id: i32,
    pub host: String,
    pub port: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicInfo {
    pub name: String,
    pub partitions: i32,
    pub replicas: i32,
    pub internal: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterMeta {
    pub brokers: Vec<BrokerInfo>,
    pub topics: Vec<TopicInfo>,
}

fn metadata_impl(conn: &KafkaConnection) -> Result<ClusterMeta, String> {
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer
        .fetch_metadata(None, TIMEOUT)
        .map_err(|e| e.to_string())?;
    let brokers = md
        .brokers()
        .iter()
        .map(|b| BrokerInfo {
            id: b.id(),
            host: b.host().to_string(),
            port: b.port(),
        })
        .collect();
    let mut topics: Vec<TopicInfo> = md
        .topics()
        .iter()
        .map(|t| TopicInfo {
            name: t.name().to_string(),
            partitions: t.partitions().len() as i32,
            replicas: t
                .partitions()
                .first()
                .map(|p| p.replicas().len())
                .unwrap_or(0) as i32,
            internal: t.name().starts_with("__"),
        })
        .collect();
    topics.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ClusterMeta { brokers, topics })
}

#[tauri::command]
async fn kafka_metadata(conn: KafkaConnection) -> Result<ClusterMeta, String> {
    tauri::async_runtime::spawn_blocking(move || metadata_impl(&conn))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionOffsets {
    pub partition: i32,
    pub low: i64,
    pub high: i64,
}

fn topic_offsets_impl(
    conn: &KafkaConnection,
    topic: &str,
) -> Result<Vec<PartitionOffsets>, String> {
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer
        .fetch_metadata(Some(topic), TIMEOUT)
        .map_err(|e| e.to_string())?;
    let t = md
        .topics()
        .first()
        .ok_or_else(|| format!("topic not found: {topic}"))?;
    let mut out = Vec::new();
    for p in t.partitions() {
        let (low, high) = consumer
            .fetch_watermarks(topic, p.id(), TIMEOUT)
            .map_err(|e| e.to_string())?;
        out.push(PartitionOffsets {
            partition: p.id(),
            low,
            high,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn kafka_topic_offsets(
    conn: KafkaConnection,
    topic: String,
) -> Result<Vec<PartitionOffsets>, String> {
    tauri::async_runtime::spawn_blocking(move || topic_offsets_impl(&conn, &topic))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicStats {
    pub name: String,
    /// sum of (high - low) across partitions — retained message count
    pub messages: i64,
    /// sum of high watermarks — total messages ever produced
    pub high_total: i64,
}

fn topic_stats_impl(conn: &KafkaConnection) -> Result<Vec<TopicStats>, String> {
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer
        .fetch_metadata(None, TIMEOUT)
        .map_err(|e| e.to_string())?;
    // ponytail: one watermark RTT per partition, serial — fine for dev clusters,
    // batch/parallelize if a cluster with thousands of partitions shows up
    let mut out = Vec::new();
    for t in md.topics() {
        if t.name().starts_with("__") {
            continue;
        }
        let mut messages = 0i64;
        let mut high_total = 0i64;
        for p in t.partitions() {
            let (low, high) = consumer
                .fetch_watermarks(t.name(), p.id(), TIMEOUT)
                .map_err(|e| e.to_string())?;
            messages += (high - low).max(0);
            high_total += high;
        }
        out.push(TopicStats {
            name: t.name().to_string(),
            messages,
            high_total,
        });
    }
    Ok(out)
}

#[tauri::command]
async fn kafka_topic_stats(conn: KafkaConnection) -> Result<Vec<TopicStats>, String> {
    tauri::async_runtime::spawn_blocking(move || topic_stats_impl(&conn))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInfo {
    pub name: String,
    pub state: String,
    pub protocol_type: String,
    pub members: i32,
}

fn groups_impl(conn: &KafkaConnection) -> Result<Vec<GroupInfo>, String> {
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let list = consumer
        .fetch_group_list(None, TIMEOUT)
        .map_err(|e| e.to_string())?;
    let mut out: Vec<GroupInfo> = list
        .groups()
        .iter()
        .filter(|g| g.name() != INSPECT_GROUP)
        .map(|g| GroupInfo {
            name: g.name().to_string(),
            state: g.state().to_string(),
            protocol_type: g.protocol_type().to_string(),
            members: g.members().len() as i32,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
async fn kafka_groups(conn: KafkaConnection) -> Result<Vec<GroupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || groups_impl(&conn))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupOffset {
    pub topic: String,
    pub partition: i32,
    pub committed: i64,
    pub low: i64,
    pub high: i64,
    pub lag: i64,
}

fn group_offsets_impl(conn: &KafkaConnection, group: &str) -> Result<Vec<GroupOffset>, String> {
    let consumer = make_consumer(conn, group)?;
    let md = consumer
        .fetch_metadata(None, TIMEOUT)
        .map_err(|e| e.to_string())?;
    // ponytail: probes every partition in the cluster for this group's commits —
    // fine for dev/small clusters, switch to OffsetFetch-by-group if it gets slow
    let mut tpl = TopicPartitionList::new();
    for t in md.topics() {
        if t.name().starts_with("__") {
            continue;
        }
        for p in t.partitions() {
            tpl.add_partition(t.name(), p.id());
        }
    }
    let committed = consumer
        .committed_offsets(tpl, TIMEOUT)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for el in committed.elements() {
        if let Offset::Offset(c) = el.offset() {
            let (low, high) = consumer
                .fetch_watermarks(el.topic(), el.partition(), TIMEOUT)
                .map_err(|e| e.to_string())?;
            out.push(GroupOffset {
                topic: el.topic().to_string(),
                partition: el.partition(),
                committed: c,
                low,
                high,
                lag: (high - c).max(0),
            });
        }
    }
    out.sort_by(|a, b| a.topic.cmp(&b.topic).then(a.partition.cmp(&b.partition)));
    Ok(out)
}

#[tauri::command]
async fn kafka_group_offsets(
    conn: KafkaConnection,
    group: String,
) -> Result<Vec<GroupOffset>, String> {
    tauri::async_runtime::spawn_blocking(move || group_offsets_impl(&conn, &group))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRec {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    pub timestamp: Option<i64>,
    pub key: Option<String>,
    pub payload: String,
    pub truncated: bool,
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCondition {
    pub field: String,
    pub operator: String,
    #[serde(default)]
    pub value: String,
}

fn condition_value<'a>(
    msg: &'a MessageRec,
    json: Option<&'a serde_json::Value>,
    field: &str,
) -> Option<String> {
    match field {
        "key" => msg.key.clone(),
        "partition" => Some(msg.partition.to_string()),
        "offset" => Some(msg.offset.to_string()),
        "timestamp" => msg.timestamp.map(|v| v.to_string()),
        _ if field.starts_with("headers.") => msg
            .headers
            .iter()
            .find(|(key, _)| key == &field[8..])
            .map(|(_, value)| value.clone()),
        _ => {
            let path = field.strip_prefix("value.").unwrap_or(field);
            let mut value = json?;
            for part in path.split('.').filter(|part| !part.is_empty()) {
                value = value.get(part)?;
            }
            match value {
                serde_json::Value::String(v) => Some(v.clone()),
                serde_json::Value::Null => Some("null".into()),
                other => Some(other.to_string()),
            }
        }
    }
}

fn matches_conditions(msg: &MessageRec, conditions: &[SearchCondition]) -> bool {
    let needs_json = conditions.iter().any(|condition| {
        !matches!(
            condition.field.as_str(),
            "key" | "partition" | "offset" | "timestamp"
        ) && !condition.field.starts_with("headers.")
    });
    let json = needs_json
        .then(|| serde_json::from_str::<serde_json::Value>(&msg.payload).ok())
        .flatten();
    conditions.iter().all(|condition| {
        let actual = condition_value(msg, json.as_ref(), condition.field.trim());
        if condition.operator == "exists" {
            return actual.is_some();
        }
        let Some(actual) = actual else { return false };
        match condition.operator.as_str() {
            "equals" => actual == condition.value,
            "notEquals" => actual != condition.value,
            "contains" => actual.contains(&condition.value),
            "gt" | "gte" | "lt" | "lte" => {
                let Ok(left) = actual.parse::<f64>() else {
                    return false;
                };
                let Ok(right) = condition.value.parse::<f64>() else {
                    return false;
                };
                match condition.operator.as_str() {
                    "gt" => left > right,
                    "gte" => left >= right,
                    "lt" => left < right,
                    _ => left <= right,
                }
            }
            _ => false,
        }
    })
}

fn push_candidate(batch: &mut Vec<MessageRec>, emitted: &mut usize, msg: MessageRec) {
    if *emitted < SEARCH_RESULT_CAP {
        batch.push(msg);
        *emitted += 1;
    }
}

fn advance_offset_progress(cursor: &mut i64, offset: i64) -> i64 {
    let next = offset + 1;
    let advanced = (next - *cursor).max(0);
    *cursor = (*cursor).max(next);
    advanced
}

fn validate_conditions(conditions: &[SearchCondition]) -> Result<(), String> {
    const OPERATORS: &[&str] = &[
        "equals",
        "notEquals",
        "contains",
        "exists",
        "gt",
        "gte",
        "lt",
        "lte",
    ];
    for condition in conditions {
        let field = condition.field.trim();
        let valid_field = matches!(field, "key" | "partition" | "offset" | "timestamp")
            || field
                .strip_prefix("headers.")
                .is_some_and(|path| !path.is_empty() && !path.contains(".."))
            || field
                .strip_prefix("value.")
                .is_some_and(|path| !path.is_empty() && !path.split('.').any(str::is_empty));
        if !valid_field {
            return Err(format!("invalid search field: {}", condition.field));
        }
        if !OPERATORS.contains(&condition.operator.as_str()) {
            return Err(format!("invalid search operator: {}", condition.operator));
        }
        if condition.operator != "exists" && condition.value.trim().is_empty() {
            return Err(format!("value required for {field}"));
        }
        if matches!(condition.operator.as_str(), "gt" | "gte" | "lt" | "lte")
            && condition.value.parse::<f64>().is_err()
        {
            return Err(format!("numeric value required for {field}"));
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchBatch {
    search_id: String,
    messages: Vec<MessageRec>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchProgress {
    search_id: String,
    scanned: i64,
    total: i64,
    completed_partitions: usize,
    total_partitions: usize,
    candidate_matches: i64,
    elapsed_ms: u64,
    messages_per_second: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchFinished {
    search_id: String,
    status: String,
    scanned: i64,
    total: i64,
    candidate_matches: i64,
    error: Option<String>,
}

fn emit_search_progress(
    app: &AppHandle,
    search_id: &str,
    scanned: i64,
    total: i64,
    completed_partitions: usize,
    total_partitions: usize,
    candidate_matches: i64,
    started: Instant,
) {
    let elapsed = started.elapsed();
    let seconds = elapsed.as_secs_f64();
    let _ = app.emit(
        "kafka-search-progress",
        SearchProgress {
            search_id: search_id.to_string(),
            scanned,
            total,
            completed_partitions,
            total_partitions,
            candidate_matches,
            elapsed_ms: elapsed.as_millis() as u64,
            messages_per_second: if seconds > 0.0 {
                scanned as f64 / seconds
            } else {
                0.0
            },
        },
    );
}

fn search_impl(
    app: AppHandle,
    search_id: String,
    conn: KafkaConnection,
    topic: String,
    text: String,
    conditions: Vec<SearchCondition>,
    cancelled: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) -> Result<(i64, i64, i64, bool, Option<String>), String> {
    let mut config = base_config(&conn);
    config
        .set("group.id", format!("{INSPECT_GROUP}-{search_id}"))
        .set("enable.auto.commit", "false")
        .set("enable.partition.eof", "true");
    let consumer: BaseConsumer = config.create().map_err(|e| e.to_string())?;
    if cancelled.load(Ordering::Relaxed) {
        return Ok((0, 0, 0, true, None));
    }
    let md = consumer
        .fetch_metadata(Some(&topic), TIMEOUT)
        .map_err(|e| e.to_string())?;
    let topic_md = md
        .topics()
        .first()
        .ok_or_else(|| format!("topic not found: {topic}"))?;
    if let Some(error) = topic_md.error() {
        return Err(format!("topic {topic}: {error:?}"));
    }
    let mut targets = HashMap::new();
    let mut cursors = HashMap::new();
    let mut tpl = TopicPartitionList::new();
    let mut total = 0i64;
    let total_partitions = topic_md.partitions().len();
    let mut completed = 0usize;
    for partition in topic_md.partitions() {
        if cancelled.load(Ordering::Relaxed) {
            return Ok((0, total, 0, true, None));
        }
        let (low, high) = consumer
            .fetch_watermarks(&topic, partition.id(), TIMEOUT)
            .map_err(|e| e.to_string())?;
        if high > low {
            tpl.add_partition_offset(&topic, partition.id(), Offset::Offset(low))
                .map_err(|e| e.to_string())?;
            targets.insert(partition.id(), high);
            cursors.insert(partition.id(), low);
            total += high - low;
        } else {
            completed += 1;
        }
    }
    if cancelled.load(Ordering::Relaxed) {
        return Ok((0, total, 0, true, None));
    }
    if targets.is_empty() {
        return Ok((0, 0, 0, false, None));
    }
    consumer.assign(&tpl).map_err(|e| e.to_string())?;

    let started = Instant::now();
    let mut last_progress = started;
    let mut scanned = 0i64;
    let mut candidate_matches = 0i64;
    let mut emitted = 0usize;
    let mut batch = Vec::with_capacity(100);
    let query = text.trim().to_lowercase();
    let mut scan_error = None;

    while completed < total_partitions && !cancelled.load(Ordering::Relaxed) {
        // Lazy scan: while the UI has buffered enough matches for the pages it is
        // showing, idle here instead of polling. The consumer keeps its assigned
        // offsets, so resuming continues exactly where it left off — no re-scan.
        // ponytail: assign (not subscribe) → no group heartbeat, safe to stop polling.
        if paused.load(Ordering::Relaxed) {
            // flush any pending matches so the paused page renders fully
            if !batch.is_empty() {
                let messages = std::mem::take(&mut batch);
                let _ = app.emit(
                    "kafka-search-batch",
                    SearchBatch {
                        search_id: search_id.clone(),
                        messages,
                    },
                );
            }
            emit_search_progress(
                &app,
                &search_id,
                scanned,
                total,
                completed,
                total_partitions,
                candidate_matches,
                started,
            );
            while paused.load(Ordering::Relaxed) && !cancelled.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(80));
            }
            last_progress = Instant::now();
            continue;
        }
        match consumer.poll(Duration::from_millis(200)) {
            Some(Ok(raw)) => {
                let partition = raw.partition();
                let offset = raw.offset();
                if let Some(cursor) = cursors.get_mut(&partition) {
                    scanned += advance_offset_progress(cursor, offset);
                }
                let raw_payload = raw.payload().unwrap_or_default();
                let full_payload = String::from_utf8_lossy(raw_payload).into_owned();
                let (display_payload, truncated) = lossy_capped(raw_payload);
                let key = raw.key().map(|v| String::from_utf8_lossy(v).into_owned());
                let headers = raw
                    .headers()
                    .map(|values| {
                        values
                            .iter()
                            .map(|header| {
                                (
                                    header.key.to_string(),
                                    String::from_utf8_lossy(header.value.unwrap_or_default())
                                        .into_owned(),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let msg = MessageRec {
                    topic: topic.clone(),
                    partition,
                    offset,
                    timestamp: raw.timestamp().to_millis(),
                    key,
                    payload: full_payload,
                    truncated,
                    headers,
                };
                let text_match = query.is_empty()
                    || msg.payload.to_lowercase().contains(&query)
                    || msg
                        .key
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(&query);
                if text_match && matches_conditions(&msg, &conditions) {
                    candidate_matches += 1;
                    let display = MessageRec {
                        payload: display_payload,
                        ..msg
                    };
                    push_candidate(&mut batch, &mut emitted, display);
                }
                if targets
                    .get(&partition)
                    .is_some_and(|high| offset + 1 >= *high)
                {
                    targets.remove(&partition);
                    completed += 1;
                }
            }
            Some(Err(rdkafka::error::KafkaError::PartitionEOF(partition))) => {
                if let Some(high) = targets.remove(&partition) {
                    if let Some(cursor) = cursors.get_mut(&partition) {
                        scanned += (high - *cursor).max(0);
                        *cursor = high;
                    }
                    completed += 1;
                }
            }
            Some(Err(error)) => {
                scan_error = Some(error.to_string());
                break;
            }
            None => {}
        }
        if batch.len() >= 100 {
            let messages = std::mem::take(&mut batch);
            let _ = app.emit(
                "kafka-search-batch",
                SearchBatch {
                    search_id: search_id.clone(),
                    messages,
                },
            );
        }
        if last_progress.elapsed() >= Duration::from_millis(250) {
            emit_search_progress(
                &app,
                &search_id,
                scanned,
                total,
                completed,
                total_partitions,
                candidate_matches,
                started,
            );
            last_progress = Instant::now();
        }
    }
    if !batch.is_empty() {
        let _ = app.emit(
            "kafka-search-batch",
            SearchBatch {
                search_id: search_id.clone(),
                messages: batch,
            },
        );
    }
    emit_search_progress(
        &app,
        &search_id,
        scanned,
        total,
        completed,
        total_partitions,
        candidate_matches,
        started,
    );
    Ok((
        scanned,
        total,
        candidate_matches,
        cancelled.load(Ordering::Relaxed),
        scan_error,
    ))
}

#[tauri::command]
async fn kafka_search_start(
    app: AppHandle,
    registry: State<'_, SearchRegistry>,
    search_id: String,
    conn: KafkaConnection,
    topic: String,
    text: String,
    conditions: Vec<SearchCondition>,
) -> Result<(), String> {
    validate_conditions(&conditions)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    registry.0.lock().map_err(|e| e.to_string())?.insert(
        search_id.clone(),
        SearchHandle {
            cancelled: cancelled.clone(),
            paused: paused.clone(),
        },
    );
    let app_for_worker = app.clone();
    let id_for_worker = search_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = search_impl(
            app_for_worker.clone(),
            id_for_worker.clone(),
            conn,
            topic,
            text,
            conditions,
            cancelled,
            paused,
        );
        let finished = match result {
            Ok((scanned, total, candidate_matches, was_cancelled, scan_error)) => SearchFinished {
                search_id: id_for_worker.clone(),
                status: if scan_error.is_some() {
                    "failed"
                } else if was_cancelled {
                    "cancelled"
                } else {
                    "completed"
                }
                .into(),
                scanned,
                total,
                candidate_matches,
                error: scan_error,
            },
            Err(error) => SearchFinished {
                search_id: id_for_worker.clone(),
                status: "failed".into(),
                scanned: 0,
                total: 0,
                candidate_matches: 0,
                error: Some(error),
            },
        };
        let _ = app_for_worker.emit("kafka-search-finished", finished);
        if let Some(registry) = app_for_worker.try_state::<SearchRegistry>() {
            if let Ok(mut searches) = registry.0.lock() {
                searches.remove(&id_for_worker);
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn kafka_search_cancel(
    registry: State<'_, SearchRegistry>,
    search_id: String,
) -> Result<(), String> {
    if let Some(handle) = registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&search_id)
    {
        handle.cancelled.store(true, Ordering::Relaxed);
        handle.paused.store(false, Ordering::Relaxed); // wake a paused scan so it can exit
    }
    Ok(())
}

#[tauri::command]
fn kafka_search_set_paused(
    registry: State<'_, SearchRegistry>,
    search_id: String,
    paused: bool,
) -> Result<(), String> {
    if let Some(handle) = registry
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&search_id)
    {
        handle.paused.store(paused, Ordering::Relaxed);
    }
    Ok(())
}

fn lossy_capped(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > PAYLOAD_CAP;
    let slice = if truncated {
        &bytes[..PAYLOAD_CAP]
    } else {
        bytes
    };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

fn consume_impl(
    conn: &KafkaConnection,
    topic: &str,
    limit: usize,
    partition: Option<i32>,
    from: &str,
    from_offset: Option<i64>,
    from_ts: Option<i64>,
) -> Result<Vec<MessageRec>, String> {
    let limit = limit.clamp(1, 10_000);
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer
        .fetch_metadata(Some(topic), TIMEOUT)
        .map_err(|e| e.to_string())?;
    let t = md
        .topics()
        .first()
        .ok_or_else(|| format!("topic not found: {topic}"))?;
    let mut partitions: Vec<i32> = t.partitions().iter().map(|p| p.id()).collect();
    if let Some(p) = partition {
        if !partitions.contains(&p) {
            return Err(format!("partition {p} does not exist on {topic}"));
        }
        partitions = vec![p];
    }
    if partitions.is_empty() {
        return Ok(Vec::new());
    }

    // "timestamp" resolves each partition's start via OffsetsForTimes in one call
    let mut ts_starts: HashMap<i32, i64> = HashMap::new();
    if from == "timestamp" {
        let ts = from_ts.ok_or("timestamp value required")?;
        let mut ts_tpl = TopicPartitionList::new();
        for &p in &partitions {
            ts_tpl
                .add_partition_offset(topic, p, Offset::Offset(ts))
                .map_err(|e| e.to_string())?;
        }
        let resolved = consumer
            .offsets_for_times(ts_tpl, TIMEOUT)
            .map_err(|e| e.to_string())?;
        for el in resolved.elements() {
            if let Offset::Offset(o) = el.offset() {
                ts_starts.insert(el.partition(), o);
            } // no message at/after ts on this partition — leave it out
        }
    }

    let per_part = (limit / partitions.len()).max(1) as i64;
    let mut tpl = TopicPartitionList::new();
    let mut target: HashMap<i32, i64> = HashMap::new(); // partition -> high watermark (stop point)
    for &p in &partitions {
        let (low, high) = consumer
            .fetch_watermarks(topic, p, TIMEOUT)
            .map_err(|e| e.to_string())?;
        if high <= low {
            continue; // empty partition
        }
        let start = match from {
            "start" => low,
            "offset" => from_offset.ok_or("offset value required")?.clamp(low, high),
            "timestamp" => match ts_starts.get(&p) {
                Some(&o) => o.clamp(low, high),
                None => continue,
            },
            _ => (high - per_part).max(low), // "end"
        };
        if start >= high {
            continue;
        }
        target.insert(p, high);
        tpl.add_partition_offset(topic, p, Offset::Offset(start))
            .map_err(|e| e.to_string())?;
    }
    if target.is_empty() {
        return Ok(Vec::new());
    }
    consumer.assign(&tpl).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut done: usize = 0;
    while out.len() < limit && done < target.len() && Instant::now() < deadline {
        match consumer.poll(Duration::from_millis(400)) {
            Some(Ok(msg)) => {
                let (payload, truncated) = lossy_capped(msg.payload().unwrap_or_default());
                let headers = msg
                    .headers()
                    .map(|hs| {
                        hs.iter()
                            .map(|h| {
                                (
                                    h.key.to_string(),
                                    String::from_utf8_lossy(h.value.unwrap_or_default())
                                        .into_owned(),
                                )
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let p = msg.partition();
                let offset = msg.offset();
                out.push(MessageRec {
                    topic: topic.to_string(),
                    partition: p,
                    offset,
                    timestamp: msg.timestamp().to_millis(),
                    key: msg.key().map(|k| String::from_utf8_lossy(k).into_owned()),
                    payload,
                    truncated,
                    headers,
                });
                if let Some(&high) = target.get(&p) {
                    if offset + 1 >= high {
                        done += 1;
                        target.remove(&p);
                    }
                }
            }
            Some(Err(e)) => return Err(e.to_string()),
            None => {}
        }
    }
    consumer.unassign().ok();
    if from == "end" {
        // newest first
        out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp).then(b.offset.cmp(&a.offset)));
    } else {
        // reading forward from a start point — oldest first
        out.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then(a.offset.cmp(&b.offset)));
    }
    out.truncate(limit);
    Ok(out)
}

#[tauri::command]
async fn kafka_consume(
    conn: KafkaConnection,
    topic: String,
    limit: usize,
    partition: Option<i32>,
    from: String,
    offset: Option<i64>,
    timestamp_ms: Option<i64>,
) -> Result<Vec<MessageRec>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        consume_impl(&conn, &topic, limit, partition, &from, offset, timestamp_ms)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Commit new offsets for a (topic, group). Fails if the group has active members —
/// same rule as `kafka-consumer-groups --reset-offsets`.
fn reset_offsets_impl(
    conn: &KafkaConnection,
    group: &str,
    topic: &str,
    to: &str,
    partition: Option<i32>,
    offset: Option<i64>,
) -> Result<Vec<GroupOffset>, String> {
    let consumer = make_consumer(conn, group)?;
    let md = consumer
        .fetch_metadata(Some(topic), TIMEOUT)
        .map_err(|e| e.to_string())?;
    let t = md
        .topics()
        .first()
        .ok_or_else(|| format!("topic not found: {topic}"))?;
    let mut partitions: Vec<i32> = t.partitions().iter().map(|p| p.id()).collect();
    if let Some(p) = partition {
        partitions = vec![p];
    }
    let mut tpl = TopicPartitionList::new();
    let mut result = Vec::new();
    for p in partitions {
        let (low, high) = consumer
            .fetch_watermarks(topic, p, TIMEOUT)
            .map_err(|e| e.to_string())?;
        let target = match to {
            "earliest" => low,
            "latest" => high,
            "offset" => offset.ok_or("offset value required")?.clamp(low, high),
            other => return Err(format!("unknown reset target: {other}")),
        };
        tpl.add_partition_offset(topic, p, Offset::Offset(target))
            .map_err(|e| e.to_string())?;
        result.push(GroupOffset {
            topic: topic.to_string(),
            partition: p,
            committed: target,
            low,
            high,
            lag: (high - target).max(0),
        });
    }
    use rdkafka::consumer::CommitMode;
    consumer
        .commit(&tpl, CommitMode::Sync)
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn kafka_reset_offsets(
    conn: KafkaConnection,
    group: String,
    topic: String,
    to: String,
    partition: Option<i32>,
    offset: Option<i64>,
) -> Result<Vec<GroupOffset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reset_offsets_impl(&conn, &group, &topic, &to, partition, offset)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProduceResult {
    pub partition: i32,
    pub offset: i64,
}

#[tauri::command]
async fn kafka_produce(
    conn: KafkaConnection,
    topic: String,
    key: Option<String>,
    payload: String,
    partition: Option<i32>,
    headers: Vec<(String, String)>,
) -> Result<ProduceResult, String> {
    let producer: FutureProducer = base_config(&conn)
        .set("message.timeout.ms", "10000")
        .create()
        .map_err(|e| e.to_string())?;
    let mut record: FutureRecord<String, String> = FutureRecord::to(&topic).payload(&payload);
    if let Some(ref k) = key {
        if !k.is_empty() {
            record = record.key(k);
        }
    }
    if let Some(p) = partition {
        record = record.partition(p);
    }
    if !headers.is_empty() {
        let mut hs = OwnedHeaders::new();
        for (k, v) in &headers {
            hs = hs.insert(Header {
                key: k,
                value: Some(v),
            });
        }
        record = record.headers(hs);
    }
    let (partition, offset) = producer
        .send(record, Duration::from_secs(10))
        .await
        .map_err(|(e, _)| e.to_string())?;
    Ok(ProduceResult { partition, offset })
}

fn make_admin(conn: &KafkaConnection) -> Result<AdminClient<DefaultClientContext>, String> {
    base_config(conn).create().map_err(|e| e.to_string())
}

#[tauri::command]
async fn kafka_create_topic(
    conn: KafkaConnection,
    topic: String,
    partitions: i32,
    replication: i32,
) -> Result<(), String> {
    let admin = make_admin(&conn)?;
    let new_topic = NewTopic::new(
        &topic,
        partitions.max(1),
        TopicReplication::Fixed(replication.max(1)),
    );
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin
        .create_topics(&[new_topic], &opts)
        .await
        .map_err(|e| e.to_string())?;
    for r in results {
        r.map_err(|(t, e)| format!("{t}: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn kafka_delete_topic(conn: KafkaConnection, topic: String) -> Result<(), String> {
    let admin = make_admin(&conn)?;
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin
        .delete_topics(&[topic.as_str()], &opts)
        .await
        .map_err(|e| e.to_string())?;
    for r in results {
        r.map_err(|(t, e)| format!("{t}: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn kafka_delete_group(conn: KafkaConnection, group: String) -> Result<(), String> {
    let admin = make_admin(&conn)?;
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin
        .delete_groups(&[group.as_str()], &opts)
        .await
        .map_err(|e| e.to_string())?;
    for r in results {
        r.map_err(|(g, e)| format!("{g}: {e}"))?;
    }
    Ok(())
}

/// List installed font family names (macOS: NSFontManager via JXA — no extra crates).
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("osascript")
        .args([
            "-l",
            "JavaScript",
            "-e",
            r#"ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"#,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let json = String::from_utf8_lossy(&out.stdout);
    let mut fonts: Vec<String> = serde_json::from_str(json.trim()).map_err(|e| e.to_string())?;
    fonts.retain(|f| !f.starts_with('.')); // hidden system families
    fonts.sort();
    Ok(fonts)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SearchRegistry::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            kafka_metadata,
            kafka_topic_offsets,
            kafka_topic_stats,
            kafka_groups,
            kafka_group_offsets,
            kafka_consume,
            kafka_search_start,
            kafka_search_cancel,
            kafka_search_set_paused,
            kafka_produce,
            kafka_reset_offsets,
            kafka_create_topic,
            kafka_delete_topic,
            kafka_delete_group,
            list_fonts
        ])
        .setup(|app| {
            // Custom menu without File > Close Window so ⌘W reaches the webview
            // (used to close the active workspace tab). Edit menu kept for copy/paste.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
                let handle = app.handle();
                let app_menu = Submenu::with_items(
                    handle,
                    "KafkaMin",
                    true,
                    &[
                        &PredefinedMenuItem::about(handle, None, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;
                let edit = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(handle, None)?,
                        &PredefinedMenuItem::redo(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::cut(handle, None)?,
                        &PredefinedMenuItem::copy(handle, None)?,
                        &PredefinedMenuItem::paste(handle, None)?,
                        &PredefinedMenuItem::select_all(handle, None)?,
                    ],
                )?;
                let window = Submenu::with_items(
                    handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::maximize(handle, None)?,
                        &PredefinedMenuItem::fullscreen(handle, None)?,
                    ],
                )?;
                let menu = Menu::with_items(handle, &[&app_menu, &edit, &window])?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(payload: &str) -> MessageRec {
        MessageRec {
            topic: "orders".into(),
            partition: 2,
            offset: 42,
            timestamp: Some(1_700_000_000_000),
            key: Some("order-42".into()),
            payload: payload.into(),
            truncated: false,
            headers: vec![("source".into(), "checkout".into())],
        }
    }

    #[test]
    fn visual_conditions_match_json_metadata_and_headers() {
        let msg = message(r#"{"user":{"id":42},"status":"paid"}"#);
        let conditions = vec![
            SearchCondition {
                field: "value.user.id".into(),
                operator: "gte".into(),
                value: "40".into(),
            },
            SearchCondition {
                field: "value.status".into(),
                operator: "equals".into(),
                value: "paid".into(),
            },
            SearchCondition {
                field: "headers.source".into(),
                operator: "contains".into(),
                value: "check".into(),
            },
            SearchCondition {
                field: "key".into(),
                operator: "exists".into(),
                value: "".into(),
            },
            SearchCondition {
                field: "partition".into(),
                operator: "lt".into(),
                value: "3".into(),
            },
        ];
        assert!(matches_conditions(&msg, &conditions));
    }

    #[test]
    fn visual_conditions_reject_non_matching_values() {
        let msg = message(r#"{"status":"failed"}"#);
        assert!(!matches_conditions(
            &msg,
            &[SearchCondition {
                field: "value.status".into(),
                operator: "notEquals".into(),
                value: "failed".into(),
            }]
        ));
        assert!(!matches_conditions(
            &msg,
            &[SearchCondition {
                field: "value.missing".into(),
                operator: "exists".into(),
                value: "".into(),
            }]
        ));
    }

    #[test]
    fn exists_matches_present_json_null() {
        let msg = message(r#"{"optional":null}"#);
        assert!(matches_conditions(
            &msg,
            &[SearchCondition {
                field: "value.optional".into(),
                operator: "exists".into(),
                value: "".into(),
            }]
        ));
    }

    #[test]
    fn validates_paths_and_numeric_comparisons() {
        assert!(validate_conditions(&[SearchCondition {
            field: "value.".into(),
            operator: "equals".into(),
            value: "x".into(),
        }])
        .is_err());
        assert!(validate_conditions(&[SearchCondition {
            field: "offset".into(),
            operator: "gt".into(),
            value: "not-a-number".into(),
        }])
        .is_err());
    }

    #[test]
    fn candidate_buffer_never_exceeds_display_limit() {
        let mut batch = Vec::new();
        let mut emitted = 9_999usize;
        push_candidate(&mut batch, &mut emitted, message("one"));
        push_candidate(&mut batch, &mut emitted, message("two"));
        assert_eq!(emitted, 10_000);
        assert_eq!(batch.len(), 1);
    }

    #[test]
    fn offset_progress_counts_compacted_gaps() {
        let mut cursor = 10i64;
        assert_eq!(advance_offset_progress(&mut cursor, 15), 6);
        assert_eq!(cursor, 16);
        assert_eq!(advance_offset_progress(&mut cursor, 18), 3);
        assert_eq!(cursor, 19);
    }
}
