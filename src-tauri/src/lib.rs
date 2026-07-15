use std::collections::HashMap;
use std::time::{Duration, Instant};

use rdkafka::admin::{AdminClient, AdminOptions, NewTopic, TopicReplication};
use rdkafka::client::DefaultClientContext;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{BaseConsumer, Consumer};
use rdkafka::message::{Header, Headers, Message, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};
use serde::{Deserialize, Serialize};

const TIMEOUT: Duration = Duration::from_secs(6);
/// group used for read-only inspection (never commits, never joins)
const INSPECT_GROUP: &str = "kafkamin-inspect";
const PAYLOAD_CAP: usize = 32 * 1024;

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
        c.set("sasl.mechanisms", conn.sasl_mechanism.as_deref().unwrap_or("PLAIN"));
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
    let md = consumer.fetch_metadata(None, TIMEOUT).map_err(|e| e.to_string())?;
    let brokers = md
        .brokers()
        .iter()
        .map(|b| BrokerInfo { id: b.id(), host: b.host().to_string(), port: b.port() })
        .collect();
    let mut topics: Vec<TopicInfo> = md
        .topics()
        .iter()
        .map(|t| TopicInfo {
            name: t.name().to_string(),
            partitions: t.partitions().len() as i32,
            replicas: t.partitions().first().map(|p| p.replicas().len()).unwrap_or(0) as i32,
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

fn topic_offsets_impl(conn: &KafkaConnection, topic: &str) -> Result<Vec<PartitionOffsets>, String> {
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer.fetch_metadata(Some(topic), TIMEOUT).map_err(|e| e.to_string())?;
    let t = md.topics().first().ok_or_else(|| format!("topic not found: {topic}"))?;
    let mut out = Vec::new();
    for p in t.partitions() {
        let (low, high) = consumer
            .fetch_watermarks(topic, p.id(), TIMEOUT)
            .map_err(|e| e.to_string())?;
        out.push(PartitionOffsets { partition: p.id(), low, high });
    }
    Ok(out)
}

#[tauri::command]
async fn kafka_topic_offsets(conn: KafkaConnection, topic: String) -> Result<Vec<PartitionOffsets>, String> {
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
    let md = consumer.fetch_metadata(None, TIMEOUT).map_err(|e| e.to_string())?;
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
        out.push(TopicStats { name: t.name().to_string(), messages, high_total });
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
    let list = consumer.fetch_group_list(None, TIMEOUT).map_err(|e| e.to_string())?;
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
    let md = consumer.fetch_metadata(None, TIMEOUT).map_err(|e| e.to_string())?;
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
    let committed = consumer.committed_offsets(tpl, TIMEOUT).map_err(|e| e.to_string())?;
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
async fn kafka_group_offsets(conn: KafkaConnection, group: String) -> Result<Vec<GroupOffset>, String> {
    tauri::async_runtime::spawn_blocking(move || group_offsets_impl(&conn, &group))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
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

fn lossy_capped(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > PAYLOAD_CAP;
    let slice = if truncated { &bytes[..PAYLOAD_CAP] } else { bytes };
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
    let limit = limit.clamp(1, 2000);
    let consumer = make_consumer(conn, INSPECT_GROUP)?;
    let md = consumer.fetch_metadata(Some(topic), TIMEOUT).map_err(|e| e.to_string())?;
    let t = md.topics().first().ok_or_else(|| format!("topic not found: {topic}"))?;
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
            ts_tpl.add_partition_offset(topic, p, Offset::Offset(ts)).map_err(|e| e.to_string())?;
        }
        let resolved = consumer.offsets_for_times(ts_tpl, TIMEOUT).map_err(|e| e.to_string())?;
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
        let (low, high) = consumer.fetch_watermarks(topic, p, TIMEOUT).map_err(|e| e.to_string())?;
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
                                (h.key.to_string(), String::from_utf8_lossy(h.value.unwrap_or_default()).into_owned())
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
    let md = consumer.fetch_metadata(Some(topic), TIMEOUT).map_err(|e| e.to_string())?;
    let t = md.topics().first().ok_or_else(|| format!("topic not found: {topic}"))?;
    let mut partitions: Vec<i32> = t.partitions().iter().map(|p| p.id()).collect();
    if let Some(p) = partition {
        partitions = vec![p];
    }
    let mut tpl = TopicPartitionList::new();
    let mut result = Vec::new();
    for p in partitions {
        let (low, high) = consumer.fetch_watermarks(topic, p, TIMEOUT).map_err(|e| e.to_string())?;
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
    consumer.commit(&tpl, CommitMode::Sync).map_err(|e| e.to_string())?;
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
            hs = hs.insert(Header { key: k, value: Some(v) });
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
    let new_topic = NewTopic::new(&topic, partitions.max(1), TopicReplication::Fixed(replication.max(1)));
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin.create_topics(&[new_topic], &opts).await.map_err(|e| e.to_string())?;
    for r in results {
        r.map_err(|(t, e)| format!("{t}: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn kafka_delete_topic(conn: KafkaConnection, topic: String) -> Result<(), String> {
    let admin = make_admin(&conn)?;
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin.delete_topics(&[topic.as_str()], &opts).await.map_err(|e| e.to_string())?;
    for r in results {
        r.map_err(|(t, e)| format!("{t}: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn kafka_delete_group(conn: KafkaConnection, group: String) -> Result<(), String> {
    let admin = make_admin(&conn)?;
    let opts = AdminOptions::new().operation_timeout(Some(TIMEOUT));
    let results = admin.delete_groups(&[group.as_str()], &opts).await.map_err(|e| e.to_string())?;
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
