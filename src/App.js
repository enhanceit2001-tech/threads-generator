import { useState, useEffect, useRef } from "react";

const CATEGORY_OPTIONS = [
  { id: "knowhow", label: "転職ノウハウ・Tips", emoji: "💡" },
  { id: "aru", label: "あるあるネタ", emoji: "😅" },
  { id: "taiken", label: "体験談・失敗談", emoji: "📖" },
  { id: "mensetsu", label: "面接対策", emoji: "🎯" },
];

const TONE_OPTIONS = [
  { id: "kyokan", label: "共感・ゆるめ" },
  { id: "jitsuyo", label: "真面目・実用的" },
  { id: "humor", label: "ユーモア・面白系" },
  { id: "honne", label: "刺さる・本音系" },
];

const STORAGE_KEY = "threads_posts_history";

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(posts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("claude_api_key") || "");
  const [apiKeySaved, setApiKeySaved] = useState(!!localStorage.getItem("claude_api_key"));
  const [categories, setCategories] = useState(["knowhow", "aru"]);
  const [tone, setTone] = useState("kyokan");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [activeTab, setActiveTab] = useState("generate");
  const [schedulerOn, setSchedulerOn] = useState(false);
  const [nextRun, setNextRun] = useState(null);
  const [gsConfig, setGsConfig] = useState({
    spreadsheetId: "",
    sheetName: "転職投稿",
    apiKey: "",
    clientId: "",
  });
  const [gsStatus, setGsStatus] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState("");
  const schedulerRef = useRef(null);
  const gapiLoaded = useRef(false);

  useEffect(() => {
    if (gapiLoaded.current) return;
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => {
      window.gapi.load("client:auth2", () => {
        gapiLoaded.current = true;
      });
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!schedulerOn) {
      clearTimeout(schedulerRef.current);
      setNextRun(null);
      return;
    }
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date();
      next.setHours(7, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      setNextRun(next);
      const ms = next - now;
      schedulerRef.current = setTimeout(async () => {
        await handleGenerate(true);
        scheduleNext();
      }, ms);
    };
    scheduleNext();
    return () => clearTimeout(schedulerRef.current);
  }, [schedulerOn, categories, tone]);

  const handleSaveApiKey = () => {
    localStorage.setItem("claude_api_key", apiKey);
    setApiKeySaved(true);
  };

  const toggleCategory = (id) => {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const categoryLabel = (id) =>
    CATEGORY_OPTIONS.find((c) => c.id === id)?.label || id;
  const toneLabel = (id) =>
    TONE_OPTIONS.find((t) => t.id === id)?.label || id;

  const buildPrompt = () => {
    const cats = categories.map(categoryLabel).join("、");
    const tn = toneLabel(tone);
    return `あなたはThreads（SNS）向けの転職コンテンツのプロライターです。
以下の条件で、Threads投稿用の台本を10本作成してください。

【カテゴリ】${cats}
【トーン】${tn}
【プラットフォーム】Threads（Instagram系）
【文字数】1投稿あたり100〜300文字
【制約】
- 読者は転職を考えている20〜40代の社会人
- 共感・保存・シェアされやすい内容
- 絵文字を効果的に使う（1〜3個程度）
- 最後に行動を促す一言か問いかけを入れる
- ハッシュタグは末尾に2〜3個

【出力形式】以下のJSONのみ出力（他のテキスト不要）:
{
  "posts": [
    {
      "id": 1,
      "category": "カテゴリ名",
      "content": "投稿本文",
      "hashtags": ["#転職", "#キャリア"]
    }
  ]
}`;
  };

  const handleGenerate = async (auto = false) => {
    if (!apiKey) {
      setError("Claude APIキーを設定してください（⚙️設定タブ）");
      setActiveTab("settings");
      return;
    }
    if (categories.length === 0) {
      setError("カテゴリを1つ以上選択してください");
      return;
    }
    setLoading(true);
    setError("");
    setPosts([]);
    if (!auto) setActiveTab("generate");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-calls": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content: buildPrompt() }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.map((b) => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const newPosts = parsed.posts.map((p) => ({
        ...p,
        fullText: `${p.content}\n\n${p.hashtags.join(" ")}`,
        date: new Date().toLocaleString("ja-JP"),
        saved: false,
      }));
      setPosts(newPosts);
      const updatedHistory = [
        { date: new Date().toLocaleString("ja-JP"), posts: newPosts },
        ...loadHistory(),
      ].slice(0, 30);
      setHistory(updatedHistory);
      saveHistory(updatedHistory);
    } catch (e) {
      setError("生成に失敗しました: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (idx) => {
    setEditingIdx(idx);
    setEditText(posts[idx].fullText);
  };

  const handleEditSave = (idx) => {
    const updated = [...posts];
    updated[idx] = { ...updated[idx], fullText: editText };
    setPosts(updated);
    setEditingIdx(null);
  };

  const initGapi = async () => {
    if (!window.gapi || !gapiLoaded.current) {
      setGsStatus("❌ Google API がロード中です。少し待ってから再試行してください。");
      return false;
    }
    try {
      await window.gapi.client.init({
        apiKey: gsConfig.apiKey,
        clientId: gsConfig.clientId,
        discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
        scope: "https://www.googleapis.com/auth/spreadsheets",
      });
      const authInstance = window.gapi.auth2.getAuthInstance();
      if (!authInstance.isSignedIn.get()) await authInstance.signIn();
      return true;
    } catch (e) {
      setGsStatus("❌ Google認証失敗: " + e.message);
      return false;
    }
  };

  const handleSaveToSheets = async () => {
    if (!gsConfig.spreadsheetId || !gsConfig.apiKey || !gsConfig.clientId) {
      setGsStatus("❌ スプレッドシートID・APIキー・クライアントIDを入力してください");
      return;
    }
    setGsStatus("⏳ Google Sheetsに接続中...");
    const ok = await initGapi();
    if (!ok) return;
    try {
      const rows = posts.map((p, i) => [
        new Date().toLocaleDateString("ja-JP"),
        i + 1,
        p.category,
        p.fullText,
        "未投稿",
      ]);
      const headerRes = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: gsConfig.spreadsheetId,
        range: `${gsConfig.sheetName}!A1:E1`,
      });
      if (!headerRes.result.values || headerRes.result.values.length === 0) {
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: gsConfig.spreadsheetId,
          range: `${gsConfig.sheetName}!A1:E1`,
          valueInputOption: "RAW",
          resource: { values: [["日付", "番号", "カテゴリ", "投稿内容", "ステータス"]] },
        });
      }
      await window.gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: gsConfig.spreadsheetId,
        range: `${gsConfig.sheetName}!A:E`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: { values: rows },
      });
      setGsStatus(`✅ ${posts.length}件をスプレッドシートに保存しました！`);
      setPosts((prev) => prev.map((p) => ({ ...p, saved: true })));
    } catch (e) {
      setGsStatus("❌ 書き込み失敗: " + e.message);
    }
  };

  const copyPost = (text) => navigator.clipboard.writeText(text);

  const styles = {
    app: { fontFamily: "'Noto Sans JP', sans-serif", minHeight: "100vh", background: "#0f0f13", color: "#e8e8f0" },
    header: { background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", padding: "32px 24px 24px", borderBottom: "1px solid #2a2a4a" },
    headerInner: { maxWidth: 840, margin: "0 auto" },
    headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 },
    icon: { width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #e040fb, #7c4dff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 },
    h1: { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" },
    sub: { margin: "4px 0 0", fontSize: 12, color: "#8888aa" },
    main: { maxWidth: 840, margin: "0 auto", padding: "24px 16px" },
    tabs: { display: "flex", gap: 4, marginBottom: 24, background: "#1a1a2e", borderRadius: 12, padding: 4 },
    card: { background: "#1a1a2e", borderRadius: 16, padding: 20, marginBottom: 16 },
    label: { margin: "0 0 12px", fontSize: 13, color: "#8888aa", fontWeight: 500 },
    chips: { display: "flex", flexWrap: "wrap", gap: 8 },
    generateBtn: (loading) => ({
      width: "100%", padding: "16px", borderRadius: 14, border: "none",
      cursor: loading ? "not-allowed" : "pointer", fontSize: 16, fontWeight: 700,
      background: loading ? "#2a2a4a" : "linear-gradient(135deg, #e040fb, #7c4dff)",
      color: loading ? "#555" : "#fff", marginBottom: 20, transition: "all 0.3s",
      boxShadow: loading ? "none" : "0 4px 20px rgba(224,64,251,0.3)",
    }),
    error: { background: "#2d1b1b", border: "1px solid #e53935", borderRadius: 12, padding: 14, marginBottom: 16, color: "#ef9a9a", fontSize: 13 },
    input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #2a2a4a", background: "#0f0f1a", color: "#e8e8f0", fontSize: 13, boxSizing: "border-box" },
  };

  return (
    <div style={styles.app}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet" />

      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.headerRow}>
            <div style={styles.icon}>✍️</div>
            <div>
              <h1 style={styles.h1}>転職投稿ジェネレーター</h1>
              <p style={styles.sub}>Threads向け・毎朝7時自動生成 → Google Sheets保存</p>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.tabs}>
          {[["generate", "🎲 生成"], ["settings", "⚙️ 設定"], ["history", "📋 履歴"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s",
                background: activeTab === id ? "linear-gradient(135deg, #e040fb, #7c4dff)" : "transparent",
                color: activeTab === id ? "#fff" : "#8888aa" }}>
              {label}
            </button>
          ))}
        </div>

        {/* GENERATE TAB */}
        {activeTab === "generate" && (
          <div>
            {!apiKeySaved && (
              <div style={{ background: "#2d1f0a", border: "1px solid #f59e0b", borderRadius: 12, padding: 14, marginBottom: 16, color: "#fcd34d", fontSize: 13 }}>
                ⚠️ まず「⚙️ 設定」タブでClaude APIキーを入力してください
              </div>
            )}
            <div style={styles.card}>
              <p style={styles.label}>📂 カテゴリ（複数選択可）</p>
              <div style={styles.chips}>
                {CATEGORY_OPTIONS.map((c) => (
                  <button key={c.id} onClick={() => toggleCategory(c.id)}
                    style={{ padding: "8px 16px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontSize: 13, fontWeight: 500, transition: "all 0.2s",
                      borderColor: categories.includes(c.id) ? "#e040fb" : "#2a2a4a",
                      background: categories.includes(c.id) ? "rgba(224,64,251,0.15)" : "transparent",
                      color: categories.includes(c.id) ? "#e040fb" : "#8888aa" }}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.card}>
              <p style={styles.label}>🎨 トーン</p>
              <div style={styles.chips}>
                {TONE_OPTIONS.map((t) => (
                  <button key={t.id} onClick={() => setTone(t.id)}
                    style={{ padding: "8px 16px", borderRadius: 20, border: "1.5px solid", cursor: "pointer", fontSize: 13, fontWeight: 500,
                      borderColor: tone === t.id ? "#7c4dff" : "#2a2a4a",
                      background: tone === t.id ? "rgba(124,77,255,0.15)" : "transparent",
                      color: tone === t.id ? "#b39ddb" : "#8888aa" }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => handleGenerate(false)} disabled={loading} style={styles.generateBtn(loading)}>
              {loading ? "⏳ Claude が台本を考えています..." : "✨ 10本の投稿台本を生成"}
            </button>

            {error && <div style={styles.error}>{error}</div>}

            {posts.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#8888aa" }}>✅ {posts.length}件 生成完了</p>
                  {gsConfig.spreadsheetId && (
                    <button onClick={handleSaveToSheets}
                      style={{ padding: "8px 18px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "linear-gradient(135deg, #00c853, #00897b)", color: "#fff" }}>
                      📊 Sheetsに全件保存
                    </button>
                  )}
                </div>
                {gsStatus && <div style={{ background: "#1a2a1a", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: "#a5d6a7" }}>{gsStatus}</div>}

                {posts.map((p, idx) => (
                  <div key={idx} style={{ background: "#1a1a2e", borderRadius: 16, padding: 18, marginBottom: 12, border: p.saved ? "1px solid #00897b" : "1px solid #2a2a4a" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ background: "rgba(124,77,255,0.2)", color: "#b39ddb", padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>#{idx + 1}</span>
                        <span style={{ color: "#8888aa", fontSize: 12 }}>{p.category}</span>
                        {p.saved && <span style={{ color: "#4caf50", fontSize: 11 }}>✅ 保存済</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleEdit(idx)}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2a2a4a", background: "transparent", color: "#8888aa", cursor: "pointer", fontSize: 12 }}>✏️</button>
                        <button onClick={() => copyPost(p.fullText)}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #2a2a4a", background: "transparent", color: "#8888aa", cursor: "pointer", fontSize: 12 }}>📋</button>
                      </div>
                    </div>
                    {editingIdx === idx ? (
                      <div>
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                          style={{ width: "100%", minHeight: 120, background: "#0f0f1a", border: "1px solid #7c4dff", borderRadius: 10, padding: 12, color: "#e8e8f0", fontSize: 14, lineHeight: 1.7, resize: "vertical", boxSizing: "border-box" }} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={() => handleEditSave(idx)}
                            style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "#7c4dff", color: "#fff", cursor: "pointer", fontSize: 13 }}>保存</button>
                          <button onClick={() => setEditingIdx(null)}
                            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #2a2a4a", background: "transparent", color: "#8888aa", cursor: "pointer", fontSize: 13 }}>キャンセル</button>
                        </div>
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", color: "#d0d0e8" }}>{p.fullText}</p>
                    )}
                    <div style={{ marginTop: 10, fontSize: 11, color: "#555" }}>{p.date} • {p.fullText.length}文字</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div>
            {/* APIキー設定 */}
            <div style={styles.card}>
              <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600 }}>🔑 Claude APIキー</p>
              <p style={{ margin: "0 0 14px", fontSize: 12, color: "#8888aa", lineHeight: 1.7 }}>
                <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" style={{ color: "#b39ddb" }}>console.anthropic.com</a> でAPIキーを取得してください。<br />
                キーはこのブラウザにのみ保存され、外部には送信されません。
              </p>
              <input type="password" value={apiKey} placeholder="sk-ant-..." onChange={(e) => setApiKey(e.target.value)} style={styles.input} />
              <button onClick={handleSaveApiKey}
                style={{ marginTop: 10, padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #e040fb, #7c4dff)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                💾 保存する
              </button>
              {apiKeySaved && <span style={{ marginLeft: 12, fontSize: 13, color: "#4caf50" }}>✅ 保存済み</span>}
            </div>

            {/* スケジューラー */}
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>⏰ 自動スケジューラー</p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8888aa" }}>毎朝7:00に自動で10本生成</p>
                </div>
                <div onClick={() => setSchedulerOn((v) => !v)}
                  style={{ width: 52, height: 28, borderRadius: 14, cursor: "pointer", transition: "background 0.3s", position: "relative",
                    background: schedulerOn ? "linear-gradient(135deg, #e040fb, #7c4dff)" : "#2a2a4a" }}>
                  <div style={{ position: "absolute", top: 3, left: schedulerOn ? 26 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 0.3s" }} />
                </div>
              </div>
              {schedulerOn && nextRun && (
                <div style={{ background: "rgba(224,64,251,0.1)", borderRadius: 10, padding: 12, fontSize: 13, color: "#e040fb" }}>
                  🕐 次回実行: {nextRun.toLocaleString("ja-JP")}
                </div>
              )}
            </div>

            {/* Google Sheets */}
            <div style={styles.card}>
              <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600 }}>📊 Google Sheets 設定</p>
              <p style={{ margin: "0 0 14px", fontSize: 12, color: "#8888aa", lineHeight: 1.7 }}>
                Google Cloud ConsoleでSheets APIを有効にし、APIキーとOAuthクライアントIDを取得してください。
              </p>
              {[
                ["spreadsheetId", "📄 スプレッドシートID", "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"],
                ["sheetName", "📋 シート名", "転職投稿"],
                ["apiKey", "🔑 Google API Key", "AIza..."],
                ["clientId", "🔐 OAuth Client ID", "xxx.apps.googleusercontent.com"],
              ].map(([key, label, placeholder]) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, color: "#8888aa", marginBottom: 6 }}>{label}</label>
                  <input type={key === "sheetName" || key === "spreadsheetId" ? "text" : "password"}
                    value={gsConfig[key]} placeholder={placeholder}
                    onChange={(e) => setGsConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={styles.input} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#555" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
                <p>まだ生成履歴がありません</p>
              </div>
            ) : (
              history.map((batch, bi) => (
                <div key={bi} style={styles.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>📅 {batch.date}</span>
                    <span style={{ fontSize: 12, color: "#8888aa" }}>{batch.posts.length}件</span>
                  </div>
                  {batch.posts.map((p, pi) => (
                    <div key={pi} style={{ borderTop: "1px solid #2a2a4a", paddingTop: 10, marginTop: 10 }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "#7c4dff" }}>#{pi + 1}</span>
                        <span style={{ fontSize: 11, color: "#8888aa" }}>{p.category}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: "#b0b0c8", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{p.fullText.slice(0, 120)}...</p>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
