import React, { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Database as DbIcon, Download, Filter, FileCheck, Trash2, AlertCircle } from 'lucide-react';
import { encryptJson } from './cryptoService';
import {
  MQAssignmentSpec,
  MQQuestion,
  DbModule,
  DbChapter,
  DbQuestionRow,
  QuestionStatus,
} from './types';

// sql.js is loaded as a global from <script> in index.html.
// Avoid Vite's ESM bundling friction with the npm package.
type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (params: unknown[]) => boolean;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
  close: () => void;
};
type SqlJsModule = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};
type InitSqlJsFn = (cfg: { locateFile?: (file: string) => string }) => Promise<SqlJsModule>;
declare global {
  interface Window {
    initSqlJs?: InitSqlJsFn;
  }
}

const SQL_WASM_CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.wasm';

const App: React.FC = () => {
  const [db, setDb] = useState<SqlJsDatabase | null>(null);
  const [dbName, setDbName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [modules, setModules] = useState<DbModule[]>([]);
  const [chapters, setChapters] = useState<DbChapter[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<DbQuestionRow[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<QuestionStatus | 'all'>('approved');
  const [difficultyFilter, setDifficultyFilter] = useState<number | 'all'>('all');

  // Pool: ordered list of selected question ids
  const [poolIds, setPoolIds] = useState<number[]>([]);

  // Assignment config
  const [courseCode, setCourseCode] = useState<string>('EEC1');
  const [title, setTitle] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('12:00');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number>(15);
  const [questionsPerStudent, setQuestionsPerStudent] = useState<number>(5);
  const [shuffleQuestions, setShuffleQuestions] = useState<boolean>(true);
  const [shuffleChoices, setShuffleChoices] = useState<boolean>(true);
  const [preamble, setPreamble] = useState<string>(
    'This is a timed pre-lecture reading check. You will see a randomly selected subset of questions from the pool. Once you start, the timer begins and cannot be paused. When the timer ends or you submit, your answers are recorded.'
  );

  // ---- Load .db file via sql.js ----
  const handleDbFile = async (file: File) => {
    setLoading(true);
    setError('');
    try {
      if (!window.initSqlJs) {
        throw new Error('sql.js failed to load from CDN. Check your internet connection.');
      }
      const SQL = await window.initSqlJs({ locateFile: () => SQL_WASM_CDN });
      const buf = new Uint8Array(await file.arrayBuffer());
      const newDb = new SQL.Database(buf);
      setDb(newDb);
      setDbName(file.name);
      // Load modules
      const modRows = newDb.exec(
        'SELECT id, number, title, course FROM modules ORDER BY number'
      );
      const ms: DbModule[] =
        modRows[0]?.values.map((r) => ({
          id: r[0] as number,
          number: r[1] as number,
          title: r[2] as string,
          course: r[3] as string,
        })) ?? [];
      setModules(ms);
      // Load all chapters
      const chRows = newDb.exec(
        'SELECT id, module_id, number, title FROM chapters ORDER BY module_id, CAST(number AS REAL)'
      );
      const cs: DbChapter[] =
        chRows[0]?.values.map((r) => ({
          id: r[0] as number,
          module_id: r[1] as number,
          number: r[2] as string,
          title: r[3] as string,
        })) ?? [];
      setChapters(cs);
    } catch (e) {
      setError(`Failed to load database: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // ---- Load questions when chapter selected ----
  useEffect(() => {
    if (!db || selectedChapterId == null) {
      setQuestions([]);
      return;
    }
    try {
      const sql = `
        SELECT q.id, q.type, q.title, q.question_text, q.choices,
               q.correct_answer_index, q.points, q.tolerance,
               q.feedback_correct, q.feedback_incorrect,
               q.bloom_level, q.difficulty, q.katex_present, q.status,
               m.number AS module_number,
               c.number AS chapter_number, c.title AS chapter_title,
               t.title AS topic_title, t.subtopic AS subtopic
        FROM questions q
        JOIN modules m ON q.module_id = m.id
        JOIN chapters c ON q.chapter_id = c.id
        JOIN topics t ON q.topic_id = t.id
        WHERE q.chapter_id = ?
        ORDER BY q.id
      `;
      const stmt = db.prepare(sql);
      stmt.bind([selectedChapterId]);
      const rows: DbQuestionRow[] = [];
      while (stmt.step()) {
        const r = stmt.getAsObject() as Record<string, unknown>;
        rows.push({
          id: r.id as number,
          type: r.type as DbQuestionRow['type'],
          title: r.title as string,
          question_text: r.question_text as string,
          choices: JSON.parse(r.choices as string),
          correct_answer_index: r.correct_answer_index as number,
          points: r.points as number,
          tolerance: r.tolerance as number,
          feedback_correct: r.feedback_correct as string,
          feedback_incorrect: r.feedback_incorrect as string,
          bloom_level: r.bloom_level as string,
          difficulty: r.difficulty as number,
          katex_present: !!(r.katex_present as number),
          status: r.status as QuestionStatus,
          module_number: r.module_number as number,
          chapter_number: r.chapter_number as string,
          chapter_title: r.chapter_title as string,
          topic_title: r.topic_title as string,
          subtopic: r.subtopic as string,
        });
      }
      stmt.free();
      setQuestions(rows);
    } catch (e) {
      setError(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [db, selectedChapterId]);

  // ---- Filtered question list ----
  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (statusFilter !== 'all' && q.status !== statusFilter) return false;
      if (difficultyFilter !== 'all' && q.difficulty !== difficultyFilter) return false;
      return true;
    });
  }, [questions, statusFilter, difficultyFilter]);

  // ---- Pool helpers ----
  const togglePool = (id: number) => {
    setPoolIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const addAllVisibleToPool = () => {
    setPoolIds((prev) => {
      const set = new Set(prev);
      visibleQuestions.forEach((q) => set.add(q.id));
      return Array.from(set);
    });
  };
  const removeAllVisibleFromPool = () => {
    setPoolIds((prev) => {
      const visibleIds = new Set(visibleQuestions.map((q) => q.id));
      return prev.filter((id) => !visibleIds.has(id));
    });
  };
  const clearPool = () => setPoolIds([]);

  // Master-checkbox state for the visible question list
  const visibleSelectedCount = useMemo(
    () => visibleQuestions.filter((q) => poolIds.includes(q.id)).length,
    [visibleQuestions, poolIds]
  );
  const allVisibleSelected =
    visibleQuestions.length > 0 && visibleSelectedCount === visibleQuestions.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < visibleQuestions.length;
  const toggleAllVisible = () => {
    if (allVisibleSelected) removeAllVisibleFromPool();
    else addAllVisibleToPool();
  };

  // ---- Lookup pool questions across all loaded questions (any chapter) ----
  // We keep a flat cache of all questions ever loaded so the pool persists
  // when the user navigates between chapters.
  const [questionCache, setQuestionCache] = useState<Map<number, DbQuestionRow>>(new Map());
  useEffect(() => {
    setQuestionCache((prev) => {
      const next = new Map(prev);
      questions.forEach((q) => next.set(q.id, q));
      return next;
    });
  }, [questions]);

  const poolQuestions = useMemo(
    () => poolIds.map((id) => questionCache.get(id)).filter(Boolean) as DbQuestionRow[],
    [poolIds, questionCache]
  );

  // ---- Validation ----
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!courseCode.trim()) issues.push('Course code is required.');
    if (!title.trim()) issues.push('Title is required.');
    if (!dueDate) issues.push('Due date is required.');
    if (poolQuestions.length < questionsPerStudent) {
      issues.push(
        `Pool has ${poolQuestions.length} questions but ${questionsPerStudent} are drawn per student. Pool must be >= N.`
      );
    }
    if (questionsPerStudent < 1) issues.push('Questions per student must be >= 1.');
    if (timeLimitMinutes < 1) issues.push('Time limit must be >= 1 minute.');
    return issues;
  }, [courseCode, title, dueDate, poolQuestions.length, questionsPerStudent, timeLimitMinutes]);

  // The id is generated once per Maker session so the standard export and any
  // accommodation variants share the same assignment_id (autograder sees them
  // as the same assignment, distributed via different files).
  const [assignmentId] = useState<string>(() => uuidv4());

  // ---- Common path for building and downloading an encrypted assignment file ----
  const buildAndDownload = async (
    overrides: { timeLimitMinutes: number; variant_label?: string; variant_multiplier?: number },
    filenameSuffix: string,
  ) => {
    const now = Date.now();
    const spec: MQAssignmentSpec = {
      schema_version: 1,
      id: assignmentId,
      courseCode: courseCode.trim(),
      title: title.trim(),
      dueDate,
      dueTime,
      timeLimitMinutes: overrides.timeLimitMinutes,
      questionsPerStudent,
      shuffleQuestions,
      shuffleChoices,
      preamble: preamble.trim(),
      questionPool: poolQuestions.map(stripStatus),
      createdAt: now,
      updatedAt: now,
      ...(overrides.variant_label ? { variant_label: overrides.variant_label } : {}),
      ...(overrides.variant_multiplier ? { variant_multiplier: overrides.variant_multiplier } : {}),
    };
    try {
      const encoded = await encryptJson(spec);
      const blob = new Blob([encoded], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeTitle = title.replace(/[^a-z0-9_\-]/gi, '_');
      a.href = url;
      a.download = `${courseCode}_${safeTitle}_mq${filenameSuffix}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ---- Standard export ----
  const handleExport = async () => {
    if (validation.length > 0) return;
    await buildAndDownload({ timeLimitMinutes }, '');
  };

  // ---- Accommodation variant export ----
  const exportVariant = async (multiplier: number, customLabel?: string) => {
    if (validation.length > 0) return;
    const newMinutes = Math.max(1, Math.round(timeLimitMinutes * multiplier));
    const xLabel = `${multiplier}x`.replace('.', '_'); // 1.5 -> 1_5 (filename-safe)
    const label = customLabel?.trim() || `${multiplier}x accommodation`;
    await buildAndDownload(
      {
        timeLimitMinutes: newMinutes,
        variant_label: label,
        variant_multiplier: multiplier,
      },
      `_${xLabel}`,
    );
  };
  const exportCustomMinutes = async (newMinutes: number, customLabel?: string) => {
    if (validation.length > 0) return;
    if (!isFinite(newMinutes) || newMinutes < 1) return;
    const label = customLabel?.trim() || `custom ${newMinutes}min`;
    const slug = `${newMinutes}min`;
    await buildAndDownload(
      {
        timeLimitMinutes: newMinutes,
        variant_label: label,
      },
      `_${slug}`,
    );
  };

  // Variant UI state
  const [variantCustomMinutes, setVariantCustomMinutes] = useState<number | ''>('');
  const [variantCustomLabel, setVariantCustomLabel] = useState<string>('');

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-slate-900 text-white p-4 shadow border-b border-slate-700">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold">
                Veri<span className="text-[#00A4E4]">Q</span>Ai
              </h1>
              <div className="text-xs text-slate-400">MQ Assignment Maker</div>
            </div>
            <div className="hidden md:block border-l border-slate-700 pl-4">
              <p className="text-sm text-slate-200">
                Build a question pool from the bank, configure the quiz, export an encrypted assignment file.
              </p>
            </div>
          </div>
          {dbName && (
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <DbIcon className="w-4 h-4" />
              <span>{dbName}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 grid grid-cols-12 gap-4">
        {error && (
          <div className="col-span-12 bg-red-50 border border-red-300 text-red-800 p-3 rounded flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
            <button onClick={() => setError('')} className="text-red-600 hover:underline text-sm">dismiss</button>
          </div>
        )}

        {/* Left column: DB + chapter list */}
        <section className="col-span-3 bg-white rounded shadow p-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2">Question bank (.db)</label>
            <input
              type="file"
              accept=".db,.sqlite,.sqlite3"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleDbFile(f);
              }}
              className="block w-full text-sm"
            />
            {loading && <p className="text-xs text-gray-500 mt-1">Loading...</p>}
          </div>

          {modules.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Chapters</h2>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {modules.map((m) => {
                  const chs = chapters.filter((c) => c.module_id === m.id);
                  return (
                    <div key={m.id}>
                      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mt-2">
                        Module {m.number}: {m.title}
                      </div>
                      {chs.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setSelectedChapterId(c.id)}
                          className={`block w-full text-left text-sm py-1.5 px-2 rounded hover:bg-blue-50 ${
                            selectedChapterId === c.id ? 'bg-blue-100 font-semibold' : ''
                          }`}
                        >
                          Ch {c.number}: {c.title}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Middle column: questions in selected chapter */}
        <section className="col-span-6 bg-white rounded shadow p-4">
          {selectedChapterId == null ? (
            <p className="text-gray-500 text-sm">Load a database and select a chapter to browse questions.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">
                  Questions ({visibleQuestions.length} shown / {questions.length} total)
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addAllVisibleToPool}
                    disabled={allVisibleSelected || visibleQuestions.length === 0}
                    className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded font-medium"
                  >
                    Select all {visibleQuestions.length}
                  </button>
                  <button
                    onClick={removeAllVisibleFromPool}
                    disabled={visibleSelectedCount === 0}
                    className="text-sm px-3 py-1.5 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-gray-800 rounded font-medium"
                  >
                    Deselect visible
                  </button>
                </div>
              </div>

              {visibleQuestions.length > 0 && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    className="cursor-pointer"
                  />
                  <span className="text-sm text-gray-700">
                    {visibleSelectedCount === 0
                      ? 'Select all visible'
                      : allVisibleSelected
                      ? `All ${visibleQuestions.length} visible selected (click to deselect)`
                      : `${visibleSelectedCount} of ${visibleQuestions.length} visible selected`}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 mb-3 text-sm">
                <Filter className="w-4 h-4 text-gray-500" />
                <label className="flex items-center gap-1">
                  Status:
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as QuestionStatus | 'all')}
                    className="border rounded px-1 py-0.5 text-sm"
                  >
                    <option value="approved">Approved</option>
                    <option value="draft">Draft</option>
                    <option value="failed">Failed</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Difficulty:
                  <select
                    value={difficultyFilter}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDifficultyFilter(v === 'all' ? 'all' : Number(v));
                    }}
                    className="border rounded px-1 py-0.5 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {visibleQuestions.map((q) => {
                  const inPool = poolIds.includes(q.id);
                  return (
                    <div
                      key={q.id}
                      className={`border rounded p-2 ${
                        inPool ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inPool}
                          onChange={() => togglePool(q.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                            <span>#{q.id}</span>
                            <span>{q.type}</span>
                            <span>D{q.difficulty}</span>
                            <span>{q.bloom_level}</span>
                            <span>{q.points}pt</span>
                            <span
                              className={`px-1 rounded ${
                                q.status === 'approved'
                                  ? 'bg-green-100 text-green-800'
                                  : q.status === 'failed'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {q.status}
                            </span>
                          </div>
                          <div className="text-sm font-medium">{q.title}</div>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">
                            {q.question_text}
                          </div>
                          <details className="text-xs text-gray-600 mt-1">
                            <summary className="cursor-pointer">Show choices</summary>
                            <ol className="list-[upper-alpha] ml-5 mt-1 space-y-0.5">
                              {q.choices.map((c, i) => (
                                <li
                                  key={i}
                                  className={
                                    i === q.correct_answer_index ? 'font-semibold text-green-700' : ''
                                  }
                                >
                                  {c}
                                </li>
                              ))}
                            </ol>
                          </details>
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* Right column: pool + config + export */}
        <section className="col-span-3 bg-white rounded shadow p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Pool ({poolQuestions.length})</h2>
              {poolQuestions.length > 0 && (
                <button
                  onClick={clearPool}
                  className="text-xs text-red-600 hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> clear
                </button>
              )}
            </div>
            <div className="text-xs text-gray-600 max-h-40 overflow-y-auto border rounded p-1">
              {poolQuestions.length === 0 ? (
                <span className="text-gray-400">No questions selected.</span>
              ) : (
                poolQuestions.map((q) => (
                  <div key={q.id} className="flex items-center justify-between py-0.5">
                    <span className="truncate">#{q.id} {q.title}</span>
                    <button
                      onClick={() => togglePool(q.id)}
                      className="text-red-500 hover:text-red-700"
                      title="Remove"
                    >
                      x
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <hr />

          <div className="space-y-2 text-sm">
            <h2 className="font-semibold">Assignment config</h2>
            <label className="block">
              <span className="text-xs text-gray-600">Course code</span>
              <input
                type="text"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Module 7 Reading Check"
                className="w-full border rounded px-2 py-1"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-600">Due date</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Due time</span>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="w-full border rounded px-2 py-1"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-600">Time limit (min)</span>
                <input
                  type="number"
                  min={1}
                  value={timeLimitMinutes}
                  onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
                  className="w-full border rounded px-2 py-1"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">N per student</span>
                <input
                  type="number"
                  min={1}
                  value={questionsPerStudent}
                  onChange={(e) => setQuestionsPerStudent(Number(e.target.value))}
                  className="w-full border rounded px-2 py-1"
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
              />
              <span className="text-xs">Shuffle question order</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shuffleChoices}
                onChange={(e) => setShuffleChoices(e.target.checked)}
              />
              <span className="text-xs">Shuffle answer choices</span>
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Preamble (shown before quiz)</span>
              <textarea
                value={preamble}
                onChange={(e) => setPreamble(e.target.value)}
                rows={4}
                className="w-full border rounded px-2 py-1 text-xs"
              />
            </label>
          </div>

          {validation.length > 0 && (
            <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
              {validation.map((v, i) => (
                <li key={i}>- {v}</li>
              ))}
            </ul>
          )}

          <button
            onClick={handleExport}
            disabled={validation.length > 0}
            className={`w-full py-2 rounded font-semibold flex items-center justify-center gap-2 ${
              validation.length > 0
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            <Download className="w-4 h-4" />
            Export standard .json ({timeLimitMinutes} min)
          </button>
          {validation.length === 0 && poolQuestions.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-green-700">
              <FileCheck className="w-3 h-3" />
              Ready to export
            </div>
          )}

          <hr />

          {/* Accommodation variants */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Accommodation variants</h3>
            <p className="text-xs text-gray-600">
              Same questions, same answer key, different time limit. Distribute the
              appropriate file to each student. All variants share the same
              assignment id, so the Gradescope autograder grades them identically.
            </p>

            <div className="grid grid-cols-3 gap-2">
              {[1.25, 1.5, 2].map((mult) => {
                const newMin = Math.max(1, Math.round(timeLimitMinutes * mult));
                return (
                  <button
                    key={mult}
                    onClick={() => exportVariant(mult)}
                    disabled={validation.length > 0}
                    className={`text-xs py-1.5 px-2 rounded font-medium border ${
                      validation.length > 0
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white hover:bg-blue-50 border-blue-300 text-blue-800'
                    }`}
                    title={`Export ${mult}x time-limit variant (${newMin} min)`}
                  >
                    {mult}x
                    <span className="block text-[10px] text-gray-500">{newMin} min</span>
                  </button>
                );
              })}
            </div>

            <div className="border-t pt-2 space-y-2">
              <p className="text-xs text-gray-600">Or set a custom time limit for one student:</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-gray-500">Minutes</span>
                  <input
                    type="number"
                    min={1}
                    value={variantCustomMinutes}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVariantCustomMinutes(v === '' ? '' : Number(v));
                    }}
                    placeholder={`${timeLimitMinutes}`}
                    className="w-full border rounded px-2 py-1 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-gray-500">Label (optional)</span>
                  <input
                    type="text"
                    value={variantCustomLabel}
                    onChange={(e) => setVariantCustomLabel(e.target.value)}
                    placeholder="e.g., SDC Jane S."
                    className="w-full border rounded px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <button
                onClick={() => {
                  if (typeof variantCustomMinutes === 'number') {
                    void exportCustomMinutes(variantCustomMinutes, variantCustomLabel);
                  }
                }}
                disabled={
                  validation.length > 0 ||
                  variantCustomMinutes === '' ||
                  (typeof variantCustomMinutes === 'number' && variantCustomMinutes < 1)
                }
                className={`w-full text-xs py-1.5 rounded font-medium ${
                  validation.length > 0 ||
                  variantCustomMinutes === '' ||
                  (typeof variantCustomMinutes === 'number' && variantCustomMinutes < 1)
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300'
                }`}
              >
                Export custom variant
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

// Strip the status field; spec stores only what the autograder/student needs.
const stripStatus = (q: DbQuestionRow): MQQuestion => {
  const { status: _ignored, ...rest } = q;
  return rest;
};

export default App;
