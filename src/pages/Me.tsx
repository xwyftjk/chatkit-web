import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { getProfile, updateProfile } from '../api/profile.js';
import { listMemories, searchMemories, deleteMemory, getCoactivatedRelated, temporalSearch, type Memory, type MemoryType, type TemporalEntity, type TemporalRelation } from '../api/memory.js';
import type { Profile } from '../api/profile.js';
import ForceGraph2D from 'react-force-graph-2d';

const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  episodic: '情景',
  semantic: '语义',
  procedural: '程序性',
  emotional: '情绪',
};

const MEMORY_TYPE_COLOR: Record<MemoryType, string> = {
  episodic: '#3b82f6',
  semantic: '#22c55e',
  procedural: '#f59e0b',
  emotional: '#a855f7',
};

/** 概念星图实体类型（与 temporal-store / temporal-graph-service 一致） */
const ENTITY_TYPE_LABEL: Record<string, string> = {
  preference: '偏好',
  goal: '目标',
  fact: '信息',
  event: '事件',
  person: '人物',
  asset: '资产',
  topic: '关注话题',
  emotional_state: '情绪',
  market_event: '市场事件',
  risk_preference: '风险偏好',
  company_event: '公司事件',
  company: '公司',
  employment: '工作经历',
  episode: '情景',
  portfolio_action: '组合操作',
};

/** 关系类型展示文案（概念星图关系图） */
const RELATION_TYPE_LABEL: Record<string, string> = {
  prefers: '偏好',
  avoids: '避免',
  related_to: '相关',
  changed_to: '变为',
  caused_by: '源于',
  interested_in: '感兴趣',
  owns: '拥有',
  wants: '想要',
};

/** 概念关系图：节点=实体，边=关系，力导向布局 */
function ConceptRelationGraph({
  entities,
  relations,
  entityTypeLabel,
}: {
  entities: TemporalEntity[];
  relations: TemporalRelation[];
  entityTypeLabel: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 420 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.offsetWidth || 640, h: 420 });
    });
    ro.observe(el);
    setSize({ w: el.offsetWidth || 640, h: 420 });
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const idSet = new Set(entities.map((e) => e.entity_id));
    const links = relations
      .filter((r) => idSet.has(r.source_entity_id) && idSet.has(r.target_entity_id))
      .map((r) => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        relation_type: r.relation_type,
      }));
    const degreeById = new Map<string, number>();
    for (const l of links) {
      degreeById.set(l.source, (degreeById.get(l.source) ?? 0) + 1);
      degreeById.set(l.target, (degreeById.get(l.target) ?? 0) + 1);
    }
    const nodes = entities.map((e) => ({
      id: e.entity_id,
      name: e.name,
      entity_type: e.entity_type,
      label: entityTypeLabel[e.entity_type] ?? e.entity_type,
      degree: degreeById.get(e.entity_id) ?? 0,
    }));
    return { nodes, links };
  }, [entities, relations, entityTypeLabel]);

  if (graphData.nodes.length === 0) {
    return <p className="text-gray-500 text-sm py-4">当前页无实体，无法绘制关系图</p>;
  }

  const fgProps = {
    graphData,
    nodeId: 'id' as const,
    nodeVal: (n: { degree?: number }) => 1 + (typeof (n as { degree?: number }).degree === 'number' ? (n as { degree: number }).degree : 0) * 0.8,
    nodeRelSize: 6,
    nodeLabel: (n: { name?: string; label?: string; id?: string; degree?: number }) => {
      const no = n as { label?: string; name?: string; id?: string; degree?: number };
      return `${no.label ?? ''} · ${no.name ?? no.id}${no.degree != null && no.degree > 0 ? ` (${no.degree} 条边)` : ''}`;
    },
    linkLabel: (l: { relation_type?: string }) => RELATION_TYPE_LABEL[(l as { relation_type?: string }).relation_type ?? ''] ?? (l as { relation_type?: string }).relation_type ?? '',
    linkWidth: (l: { relation_type?: string }) => ((l as { relation_type?: string }).relation_type ? 2 : 1),
    nodeColor: (n: { degree?: number }) => {
      const d = (n as { degree?: number }).degree ?? 0;
      const stars = ['#fef9c3', '#fef08a', '#fde047', '#fef3c7', '#fefce8'];
      return stars[Math.min(d % stars.length, stars.length - 1)];
    },
    linkColor: () => 'rgba(255,255,255,0.35)',
    linkDirectionalArrowLength: 6,
    linkDirectionalArrowRelPos: 1,
    linkCurvature: 0.15,
    backgroundColor: '#000000',
    width: size.w,
    height: size.h,
  };

  return (
    <div ref={containerRef} className="w-full rounded border border-gray-800 bg-black" style={{ height: 420 }}>
      {/* nodeVal/linkWidth 由库支持，泛型推断导致类型报错故用断言 */}
      <ForceGraph2D {...(fgProps as any)} />
    </div>
  );
}

/** 四种记忆类型图标（情景/语义/程序性/情绪） */
function MemoryTypeIcon({ type, className = '', title }: { type: MemoryType; className?: string; title?: string }) {
  const color = MEMORY_TYPE_COLOR[type];
  const size = 20;
  const icon = (() => {
    switch (type) {
      case 'episodic':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ width: size, height: size }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        );
      case 'semantic':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ width: size, height: size }}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="16" y2="10" />
          </svg>
        );
      case 'procedural':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ width: size, height: size }}>
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        );
      case 'emotional':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ width: size, height: size }}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        );
    }
  })();
  return title ? <span title={title}>{icon}</span> : icon;
}

/** 风险偏好枚举标签（profile-store: conservative | moderate | aggressive） */
const RISK_TOLERANCE_LABEL: Record<string, string> = {
  conservative: '保守',
  moderate: '稳健',
  aggressive: '积极',
};

/** 投资期限枚举标签（profile-store: short | medium | long） */
const INVESTMENT_HORIZON_LABEL: Record<string, string> = {
  short: '短期',
  medium: '中期',
  long: '长期',
};

/** ISO 时间转本地时间显示（画像更新时间等） */
function formatProfileUpdatedAt(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short', hour12: false });
  } catch {
    return iso;
  }
}

/** 记忆内容展示前去掉后端/ mem0 加的前缀：如 [now]、[日期]、[类型] */
function stripMemoryContentPrefix(content: string): string {
  return content
    .replace(/^\[now\]\s*/i, '')
    .replace(/^\[\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?\]\s*/i, '')
    .replace(/^\[(情景|语义|程序性|情绪)\]\s*/, '')
    .trim() || content;
}

/** 记忆时间轴时间显示（日期 + 时分） */
function formatMemoryTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

/** 事实时间范围显示（valid_from ~ valid_to） */
function formatFactTimeRange(validFrom: string | undefined, validTo: string | undefined | null): string {
  const from = validFrom?.trim();
  const to = validTo?.trim() || '';
  if (!from && !to) return '—';
  const fromStr = from ? formatMemoryTime(from) : '';
  const toStr = to ? formatMemoryTime(to) : '';
  if (fromStr && toStr) return `${fromStr} ~ ${toStr}`;
  if (fromStr) return `${fromStr} 起`;
  if (toStr) return `至 ${toStr}`;
  return '—';
}

/** 日期/日期时间字符串转时间戳（用于比较）。仅日期 YYYY-MM-DD 起算 00:00，止算 23:59:59.999 */
function parseTimeBound(s: string, endOfDay: boolean): number {
  if (!s.trim()) return endOfDay ? Number.POSITIVE_INFINITY : 0;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return endOfDay ? Number.POSITIVE_INFINITY : 0;
  if (!s.includes('T') && s.length <= 10) {
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
  }
  return d.getTime();
}

/** 时间戳转 YYYY-MM-DD（endOfDay 时取当日 23:59） */
function tsToDateString(ts: number, endOfDay: boolean): string {
  const d = new Date(ts);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** 双拇指时间轴：拇指位置只存状态，渲染不根据时间算位置。拖动手柄时只把「鼠标位置」写入被拖的那只拇指；蓝条=两拇指中心之间。 */
const TRACK_WIDTH_PX = 320;
const THUMB_RADIUS_PX = 8;
const THUMB_MIN_PX = THUMB_RADIUS_PX;
const THUMB_MAX_PX = TRACK_WIDTH_PX - THUMB_RADIUS_PX;
const THUMB_RANGE_PX = THUMB_MAX_PX - THUMB_MIN_PX;

/** 轨道上像素 → 时间（只用于从位置算时间，不用于算拇指位置） */
function centerPxToTime(centerPx: number, extentMin: number, safeRange: number): number {
  const ratio = (centerPx - THUMB_MIN_PX) / THUMB_RANGE_PX;
  return extentMin + Math.max(0, Math.min(1, ratio)) * safeRange;
}

function TimeRangeSlider({
  extentMin,
  extentMax,
  valueStart,
  valueEnd,
  onChange,
  onDragStart,
  onDragEnd,
  label,
}: {
  extentMin: number;
  extentMax: number;
  valueStart: number;
  valueEnd: number;
  onChange: (start: number, end: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const dragPreviewRef = useRef<number>(0);

  const range = extentMax - extentMin;
  const safeRange = range <= 0 ? 1 : range;

  /** 拇指中心像素：只来自用户拖动，不根据时间计算。初次挂载时用 props 填一次，之后完全由用户操作 */
  const [leftCenterPx, setLeftCenterPx] = useState(THUMB_MIN_PX);
  const [rightCenterPx, setRightCenterPx] = useState(THUMB_MAX_PX);
  const leftCenterPxRef = useRef(leftCenterPx);
  const rightCenterPxRef = useRef(rightCenterPx);
  leftCenterPxRef.current = leftCenterPx;
  rightCenterPxRef.current = rightCenterPx;

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRef.current || range <= 0) return;
    hasInitializedRef.current = true;
    const ratio = (v: number) => Math.max(0, Math.min(1, (v - extentMin) / safeRange));
    setLeftCenterPx(THUMB_MIN_PX + ratio(valueStart) * THUMB_RANGE_PX);
    setRightCenterPx(THUMB_MIN_PX + ratio(valueEnd) * THUMB_RANGE_PX);
  }, [range, extentMin, safeRange, valueStart, valueEnd]);

  /** 蓝条 = 两拇指之间，完全由用户拖动决定，不计算 */
  const highlightLeftPx = Math.min(leftCenterPx, rightCenterPx);
  const highlightWidthPx = Math.abs(rightCenterPx - leftCenterPx);
  const leftPx = leftCenterPx - THUMB_RADIUS_PX;
  const rightThumbLeftPx = rightCenterPx - THUMB_RADIUS_PX;

  /** 鼠标/触摸 → 轨道内中心像素（拇指只跟到这里） */
  const clientXToCenterPx = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return THUMB_MIN_PX;
    const px = clientX - el.getBoundingClientRect().left;
    return Math.max(THUMB_MIN_PX, Math.min(THUMB_MAX_PX, px));
  }, []);

  useEffect(() => {
    if (dragging !== null) onDragStart?.();
  }, [dragging, onDragStart]);

  const formatTick = useCallback((ts: number) => {
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }, []);

  const startTs = centerPxToTime(leftCenterPx, extentMin, safeRange);
  const endTs = centerPxToTime(rightCenterPx, extentMin, safeRange);

  /** 拖动：只把鼠标位置写入被拖的那只拇指的状态（不计算另一只）；时间文案由上面 startTs/endTs 渲染 */
  const handlePointer = useCallback(
    (clientX: number) => {
      const centerPx = clientXToCenterPx(clientX);
      if (dragging === 'left') {
        leftCenterPxRef.current = centerPx;
        setLeftCenterPx(centerPx);
        dragPreviewRef.current = centerPxToTime(centerPx, extentMin, safeRange);
      } else if (dragging === 'right') {
        rightCenterPxRef.current = centerPx;
        setRightCenterPx(centerPx);
        dragPreviewRef.current = centerPxToTime(centerPx, extentMin, safeRange);
      }
    },
    [dragging, extentMin, safeRange, clientXToCenterPx]
  );

  const commitAndEndDrag = useCallback(() => {
    if (dragging === 'left') {
      onChange(dragPreviewRef.current, valueEnd);
    } else if (dragging === 'right') {
      onChange(valueStart, dragPreviewRef.current);
    }
    onDragEnd?.();
    setDragging(null);
  }, [dragging, valueStart, valueEnd, onChange, onDragEnd]);

  useEffect(() => {
    if (dragging === null) return;
    const onMove = (e: MouseEvent) => handlePointer(e.clientX);
    const onUp = () => commitAndEndDrag();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, handlePointer, commitAndEndDrag]);

  useEffect(() => {
    if (dragging === null) return;
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handlePointer(e.touches[0].clientX);
    };
    const onTouchEnd = () => commitAndEndDrag();
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [dragging, handlePointer, commitAndEndDrag]);

  if (range <= 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-gray-600 text-sm w-14 shrink-0">{label}</span>
        <span className="text-gray-400 text-xs">暂无时间范围</span>
      </div>
    );
  }

  return (
    <div
      className="time-range-slider flex items-center gap-2 shrink-0"
      style={{ width: 580, minWidth: 580, maxWidth: 580 }}
    >
      <span className="text-gray-600 text-sm w-14 shrink-0">{label}</span>
      <span className="text-gray-400 text-xs shrink-0 w-20 truncate" title={formatTick(startTs)}>{formatTick(startTs)}</span>
      <div
        className="shrink-0"
        style={{ flex: '0 0 340px', width: 340, minWidth: 340, maxWidth: 340, boxSizing: 'border-box' }}
      >
        <div
          ref={trackRef}
          className="relative h-6 flex items-center"
          style={{ width: TRACK_WIDTH_PX, minWidth: TRACK_WIDTH_PX, maxWidth: TRACK_WIDTH_PX, margin: '0 10px', boxSizing: 'content-box' }}
          role="slider"
          aria-label={label}
        >
          <div
            className="absolute h-2 top-1/2 -translate-y-1/2 rounded-full bg-gray-200"
            style={{ left: 0, width: TRACK_WIDTH_PX }}
          />
          <div
            className="absolute h-2 top-1/2 -translate-y-1/2 rounded-full bg-sky-300 pointer-events-none"
            style={{ left: `${highlightLeftPx}px`, width: `${highlightWidthPx}px` }}
          />
          <div
            className="absolute w-4 h-4 top-1/2 -translate-y-1/2 rounded-full bg-sky-500 border-2 border-white shadow cursor-grab active:cursor-grabbing z-10 touch-none"
            style={{ left: `${leftPx}px`, marginLeft: 0 }}
            onMouseDown={(e) => {
              e.preventDefault();
              dragPreviewRef.current = valueStart;
              setDragging('left');
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              dragPreviewRef.current = valueStart;
              setDragging('left');
            }}
          />
          <div
            className="absolute w-4 h-4 top-1/2 -translate-y-1/2 rounded-full bg-sky-500 border-2 border-white shadow cursor-grab active:cursor-grabbing z-10 touch-none"
            style={{ left: `${rightThumbLeftPx}px`, marginLeft: 0 }}
            onMouseDown={(e) => {
              e.preventDefault();
              dragPreviewRef.current = valueEnd;
              setDragging('right');
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              dragPreviewRef.current = valueEnd;
              setDragging('right');
            }}
          />
        </div>
      </div>
      <span className="text-gray-400 text-xs shrink-0 w-20 text-right truncate" title={formatTick(endTs)}>{formatTick(endTs)}</span>
    </div>
  );
}

/** 人生大事 type 的常见中文标签（无 description 时使用） */
const LIFE_EVENT_TYPE_LABEL: Record<string, string> = {
  child_birth: '孩子出生',
  child_started_college: '孩子上大学',
  marriage: '结婚',
  job_change: '换工作',
  retirement: '退休',
  relocation: '搬迁',
};

export function Me() {
  const user_id = useAuthStore((s) => s.user_id);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<MemoryType | ''>('');
  const [memoryPage, setMemoryPage] = useState(1);
  /** 双时效本地筛选（可选）：记忆时间 = created_at 区间，事实时间 = valid_from/valid_to 区间 */
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');
  const [factFrom, setFactFrom] = useState('');
  const [factTo, setFactTo] = useState('');
  const MEMORY_PAGE_SIZE = 10;
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [copyIdFeedback, setCopyIdFeedback] = useState(false);
  /** 编辑态草稿：仅可编辑的字段 */
  const [editDraft, setEditDraft] = useState<{
    risk_tolerance: string;
    investment_horizon: string;
    asset_preferences: string;
    asset_exclusions: string;
  }>({ risk_tolerance: '', investment_horizon: '', asset_preferences: '', asset_exclusions: '' });
  /** 时间筛选区 DOM 引用：拖动时直接改 class，不 setState，避免 Me 重渲染导致整块布局/长度变化 */
  const timeFilterRef = useRef<HTMLDivElement>(null);
  const conceptTimeFilterRef = useRef<HTMLDivElement>(null);
  /** 穿越银河：当前展开的记忆 id 集合（主列表或任意层共激活均可展开）；每 id 对应已拉取的共激活列表 */
  const [expandedCoactivatedIds, setExpandedCoactivatedIds] = useState<string[]>([]);
  const [coactivatedRelated, setCoactivatedRelated] = useState<Record<string, { related: (Memory & { hop?: number })[]; related_ids?: string[]; loading?: boolean }>>({});
  /** 个人中心下方 Tab：记忆银河 | 概念星图 */
  const [meTab, setMeTab] = useState<'memory' | 'concept'>('memory');
  /** 概念星图：关键词搜索（名称/描述）、类型、双时间轴 */
  const [conceptQuery, setConceptQuery] = useState('');
  const [conceptEntityType, setConceptEntityType] = useState('');
  const [conceptCreatedAfter, setConceptCreatedAfter] = useState('');
  const [conceptCreatedBefore, setConceptCreatedBefore] = useState('');
  const [conceptFactFrom, setConceptFactFrom] = useState('');
  const [conceptFactTo, setConceptFactTo] = useState('');
  const [conceptEntitiesRaw, setConceptEntitiesRaw] = useState<TemporalEntity[]>([]);
  const [conceptRelations, setConceptRelations] = useState<TemporalRelation[]>([]);
  const [conceptTotal, setConceptTotal] = useState(0);
  const [conceptListExpanded, setConceptListExpanded] = useState(false);
  const [conceptDetailPage, setConceptDetailPage] = useState(1);
  const [conceptLoading, setConceptLoading] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-time-filter-dragging', '');
    style.textContent = '.time-filter-dragging * { pointer-events: none; } .time-filter-dragging .time-range-slider, .time-filter-dragging .time-range-slider * { pointer-events: auto; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const handleCopyUserId = async () => {
    if (!user_id) return;
    try {
      await navigator.clipboard.writeText(user_id);
      setCopyIdFeedback(true);
      setTimeout(() => setCopyIdFeedback(false), 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  useEffect(() => {
    if (!user_id) return;
    getProfile(user_id).then(setProfile).catch(console.error);
  }, [user_id]);

  useEffect(() => {
    if (!user_id) return;
    setLoading(true);
    if (searchQuery.trim()) {
      searchMemories(searchQuery.trim(), {
        memory_types: memoryTypeFilter ? [memoryTypeFilter] : undefined,
        limit: 50,
      })
        .then((r) => {
          setMemories(r.memories);
          setTotal(r.count);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      listMemories({
        limit: MEMORY_PAGE_SIZE,
        offset: (memoryPage - 1) * MEMORY_PAGE_SIZE,
        memory_type: memoryTypeFilter || undefined,
        created_after: createdAfter || undefined,
        created_before: createdBefore || undefined,
        fact_from: factFrom || undefined,
        fact_to: factTo || undefined,
      })
        .then((r) => {
          setMemories(r.memories);
          setTotal(r.total);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [user_id, searchQuery, memoryTypeFilter, memoryPage, createdAfter, createdBefore, factFrom, factTo]);

  useEffect(() => {
    setMemoryPage(1);
  }, [searchQuery, memoryTypeFilter, createdAfter, createdBefore, factFrom, factTo]);

  const hasTimeFilter = createdAfter !== '' || createdBefore !== '' || factFrom !== '' || factTo !== '';

  /** 时间轴范围：无时间筛选时从当前 memories 计算；有时长筛选时沿用上次范围，避免滑块区间收缩 */
  const extentRef = useRef<{
    createdExtentMin: number;
    createdExtentMax: number;
    factExtentMin: number;
    factExtentMax: number;
    factAxisHidden: boolean;
  }>({
    createdExtentMin: Date.now() - 365 * 86400000,
    createdExtentMax: Date.now(),
    factExtentMin: Date.now() - 365 * 86400000,
    factExtentMax: Date.now(),
    factAxisHidden: true,
  });
  const { createdExtentMin, createdExtentMax, factExtentMin, factExtentMax, factAxisHidden } = useMemo(() => {
    const now = Date.now();
    const oneYear = 365 * 86400000;
    const sevenDays = 7 * 86400000;
    const fallbackMin = now - oneYear;
    if (hasTimeFilter) return extentRef.current;
    if (memories.length === 0) return extentRef.current;
    const hasAnyValidFrom = memories.some((m) => m.valid_from != null && String(m.valid_from).trim() !== '');
    const hasAnyValidTo = memories.some((m) => m.valid_to != null && String(m.valid_to).trim() !== '');
    const factAxisHidden_ = !hasAnyValidFrom && !hasAnyValidTo;
    let cMin = Infinity;
    const factTimePoints: number[] = [];
    for (const m of memories) {
      const ct = new Date(m.created_at).getTime();
      cMin = Math.min(cMin, ct);
      if (m.valid_from != null && String(m.valid_from).trim() !== '') {
        factTimePoints.push(new Date(m.valid_from).getTime());
      }
      if (m.valid_to != null && String(m.valid_to).trim() !== '') {
        factTimePoints.push(new Date(m.valid_to).getTime());
      }
    }
    const createdExtentMin_ = cMin === Infinity ? fallbackMin : cMin;
    const createdExtentMax_ = now;
    const minFactTime = factTimePoints.length > 0 ? Math.min(...factTimePoints) : now;
    const factExtentMin_ = factAxisHidden_ ? fallbackMin : minFactTime - sevenDays;
    const factExtentMax_ = now;
    const next = {
      createdExtentMin: createdExtentMin_,
      createdExtentMax: createdExtentMax_,
      factExtentMin: factExtentMin_,
      factExtentMax: factExtentMax_,
      factAxisHidden: factAxisHidden_,
    };
    extentRef.current = next;
    return next;
  }, [memories, hasTimeFilter]);

  /** 记忆时间轴当前选中范围（用于滑块） */
  const createdValueStart =
    createdAfter !== '' ? parseTimeBound(createdAfter, false) : createdExtentMin;
  const createdValueEnd =
    createdBefore !== '' ? parseTimeBound(createdBefore, true) : createdExtentMax;
  const factValueStart = factFrom !== '' ? parseTimeBound(factFrom, false) : factExtentMin;
  const factValueEnd = factTo !== '' ? parseTimeBound(factTo, true) : factExtentMax;

  /** 概念星图：拉取全部实体与关系（limit=0），用于关系图；实体列表在下方「查看详情」展开 */
  useEffect(() => {
    if (!user_id || meTab !== 'concept') return;
    setConceptLoading(true);
    temporalSearch({
      user_id,
      query: conceptQuery.trim(),
      entity_types: conceptEntityType ? [conceptEntityType] : undefined,
      limit: 0,
      offset: 0,
      transaction_after: conceptCreatedAfter || undefined,
      transaction_before: conceptCreatedBefore || undefined,
      fact_from: conceptFactFrom || undefined,
      fact_to: conceptFactTo || undefined,
    })
      .then((r) => {
        setConceptEntitiesRaw(r.entities);
        setConceptRelations(Array.isArray(r.relations) ? (r.relations as TemporalRelation[]) : []);
        setConceptTotal(r.total);
        setConceptDetailPage(1);
      })
      .catch(console.error)
      .finally(() => setConceptLoading(false));
  }, [user_id, meTab, conceptQuery, conceptEntityType, conceptCreatedAfter, conceptCreatedBefore, conceptFactFrom, conceptFactTo]);

  /** 概念星图时间轴范围：从当前 raw 实体计算（记录时间=transaction_time，概念时间=valid_from/valid_to） */
  const {
    conceptCreatedExtentMin,
    conceptCreatedExtentMax,
    conceptFactExtentMin,
    conceptFactExtentMax,
    conceptFactAxisHidden,
  } = useMemo(() => {
    const now = Date.now();
    const oneYear = 365 * 86400000;
    const fallbackMin = now - oneYear;
    if (conceptEntitiesRaw.length === 0) {
      return {
        conceptCreatedExtentMin: fallbackMin,
        conceptCreatedExtentMax: now,
        conceptFactExtentMin: fallbackMin,
        conceptFactExtentMax: now,
        conceptFactAxisHidden: true,
      };
    }
    let cMin = Infinity;
    let cMax = -Infinity;
    const factTimes: number[] = [];
    for (const e of conceptEntitiesRaw) {
      const tx = new Date(e.transaction_time).getTime();
      cMin = Math.min(cMin, tx);
      cMax = Math.max(cMax, tx);
      if (e.valid_from) factTimes.push(new Date(e.valid_from).getTime());
      if (e.valid_to) factTimes.push(new Date(e.valid_to).getTime());
    }
    const factMin = factTimes.length > 0 ? Math.min(...factTimes) : now;
    const factMax = factTimes.length > 0 ? Math.max(...factTimes) : now;
    const oneDay = 86400000;
    const minRange = 7 * oneDay; // 至少 7 天，避免记录时间轴范围过小导致拇指难以拖动
    const createdMin = cMin === Infinity ? fallbackMin : cMin;
    const createdMax = cMax === -Infinity ? now : cMax;
    const createdSpan = createdMax - createdMin;
    let extentMin = createdMin;
    let extentMax = createdMax;
    if (createdSpan < minRange) {
      const center = createdMin + createdSpan / 2;
      extentMin = center - minRange / 2;
      extentMax = center + minRange / 2;
    }
    return {
      conceptCreatedExtentMin: extentMin,
      conceptCreatedExtentMax: extentMax,
      conceptFactExtentMin: factMin - oneYear / 12,
      conceptFactExtentMax: factMax + 86400000,
      conceptFactAxisHidden: factTimes.length === 0,
    };
  }, [conceptEntitiesRaw]);

  /** 概念星图：列表直接用后端分页+时间过滤结果，不再做前端时间过滤 */
  const conceptEntities = conceptEntitiesRaw;

  const conceptCreatedValueStart =
    conceptCreatedAfter !== '' ? parseTimeBound(conceptCreatedAfter, false) : conceptCreatedExtentMin;
  const conceptCreatedValueEnd =
    conceptCreatedBefore !== '' ? parseTimeBound(conceptCreatedBefore, true) : conceptCreatedExtentMax;
  const conceptFactValueStart =
    conceptFactFrom !== '' ? parseTimeBound(conceptFactFrom, false) : conceptFactExtentMin;
  const conceptFactValueEnd =
    conceptFactTo !== '' ? parseTimeBound(conceptFactTo, true) : conceptFactExtentMax;

  const handleSaveProfile = async (updates: Partial<Profile>) => {
    if (!user_id) return;
    setSaveLoading(true);
    try {
      const updated = await updateProfile(user_id, updates);
      setProfile(updated);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setSaveLoading(false);
    }
  };

  const startEditing = () => {
    if (!profile) return;
    setEditDraft({
      risk_tolerance: profile.risk_tolerance ?? '',
      investment_horizon: profile.investment_horizon ?? '',
      asset_preferences: Array.isArray(profile.asset_preferences) ? profile.asset_preferences.join('、') : '',
      asset_exclusions: Array.isArray(profile.asset_exclusions) ? profile.asset_exclusions.join('、') : '',
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveEditing = async () => {
    if (!user_id || !profile) return;
    const prefs = editDraft.asset_preferences.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const excls = editDraft.asset_exclusions.split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean);
    await handleSaveProfile({
      risk_tolerance: editDraft.risk_tolerance || undefined,
      investment_horizon: editDraft.investment_horizon || undefined,
      asset_preferences: prefs.length ? prefs : undefined,
      asset_exclusions: excls.length ? excls : undefined,
    });
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (!confirm('确定忘记这条记忆？')) return;
    try {
      await deleteMemory(memoryId);
      setMemories((prev) => prev.filter((m) => m.memory_id !== memoryId));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleCoactivated = useCallback(async (memoryId: string) => {
    setExpandedCoactivatedIds((prev) => {
      const isExpanded = prev.includes(memoryId);
      if (isExpanded) return prev.filter((id) => id !== memoryId);
      return [...prev, memoryId];
    });
    const cached = coactivatedRelated[memoryId];
    if (cached && !cached.loading) return;
    setCoactivatedRelated((prev) => ({ ...prev, [memoryId]: { ...(prev[memoryId] ?? {}), loading: true } }));
    try {
      const res = await getCoactivatedRelated(memoryId, { hops: 1 });
      setCoactivatedRelated((prev) => ({
        ...prev,
        [memoryId]: { related: res.related, related_ids: res.related_ids, loading: false },
      }));
    } catch (e) {
      console.error(e);
      setCoactivatedRelated((prev) => ({
        ...prev,
        [memoryId]: { related: [], related_ids: [], loading: false },
      }));
    }
  }, [coactivatedRelated]);

  if (!user_id) return null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
        <section className="bg-white rounded-lg border p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">我的画像</h2>
              <button
                type="button"
                onClick={handleCopyUserId}
                className="text-sm px-2 py-1 border rounded text-gray-600 hover:bg-gray-50"
              >
                {copyIdFeedback ? '已复制' : '复制 ID'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button type="button" onClick={cancelEditing} className="text-sm px-2 py-1 border rounded text-gray-600 hover:bg-gray-50">
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={saveEditing}
                    disabled={saveLoading}
                    className="text-sm px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saveLoading ? '保存中…' : '保存'}
                  </button>
                </>
              ) : (
                <button type="button" onClick={startEditing} className="text-sm px-2 py-1 border rounded text-blue-600 hover:bg-blue-50">
                  编辑
                </button>
              )}
            </div>
          </div>
        {profile === null && <p className="text-gray-500">加载中…</p>}
        {profile !== null && (
          <div className="text-sm text-gray-700">
            <table className="w-full border border-gray-200 border-collapse">
              <tbody>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 w-24 font-medium">风险偏好</td>
                  <td className={`border border-gray-200 px-2 py-1.5 text-right ${editing ? 'bg-sky-50' : 'bg-white text-gray-800'}`}>
                    {editing ? (
                      <select
                        value={editDraft.risk_tolerance}
                        onChange={(e) => setEditDraft((d) => ({ ...d, risk_tolerance: e.target.value }))}
                        className="w-full max-w-[8rem] ml-auto border border-sky-300 rounded px-2 py-1 text-sm text-right bg-white"
                      >
                        <option value="">—</option>
                        <option value="conservative">保守</option>
                        <option value="moderate">稳健</option>
                        <option value="aggressive">积极</option>
                      </select>
                    ) : (
                      profile.risk_tolerance ? (RISK_TOLERANCE_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance) : '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 font-medium">投资期限</td>
                  <td className={`border border-gray-200 px-2 py-1.5 text-right ${editing ? 'bg-sky-50' : 'bg-white text-gray-800'}`}>
                    {editing ? (
                      <select
                        value={editDraft.investment_horizon}
                        onChange={(e) => setEditDraft((d) => ({ ...d, investment_horizon: e.target.value }))}
                        className="w-full max-w-[8rem] ml-auto border border-sky-300 rounded px-2 py-1 text-sm text-right bg-white"
                      >
                        <option value="">—</option>
                        <option value="short">短期</option>
                        <option value="medium">中期</option>
                        <option value="long">长期</option>
                      </select>
                    ) : (
                      profile.investment_horizon ? (INVESTMENT_HORIZON_LABEL[profile.investment_horizon] ?? profile.investment_horizon) : '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 font-medium">偏好资产</td>
                  <td className={`border border-gray-200 px-2 py-1.5 text-right ${editing ? 'bg-sky-50' : 'bg-white text-gray-800'}`}>
                    {editing ? (
                      <input
                        type="text"
                        value={editDraft.asset_preferences}
                        onChange={(e) => setEditDraft((d) => ({ ...d, asset_preferences: e.target.value }))}
                        placeholder="多个用顿号或逗号分隔"
                        className="w-full min-w-[6rem] border border-sky-300 rounded px-2 py-1 text-sm text-right bg-white"
                      />
                    ) : (
                      Array.isArray(profile.asset_preferences) && profile.asset_preferences.length ? profile.asset_preferences.join('、') : '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 font-medium">排除资产</td>
                  <td className={`border border-gray-200 px-2 py-1.5 text-right ${editing ? 'bg-sky-50' : 'bg-white text-gray-800'}`}>
                    {editing ? (
                      <input
                        type="text"
                        value={editDraft.asset_exclusions}
                        onChange={(e) => setEditDraft((d) => ({ ...d, asset_exclusions: e.target.value }))}
                        placeholder="多个用顿号或逗号分隔"
                        className="w-full min-w-[6rem] border border-sky-300 rounded px-2 py-1 text-sm text-right bg-white"
                      />
                    ) : (
                      Array.isArray(profile.asset_exclusions) && profile.asset_exclusions.length ? profile.asset_exclusions.join('、') : '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 font-medium align-top">人生大事</td>
                  <td className={`border border-gray-200 px-2 py-1.5 text-right align-top ${editing ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-800'}`}>
                    {Array.isArray(profile.life_events) && profile.life_events.length ? (
                      <ul className="list-disc list-inside space-y-0.5 text-right">
                        {profile.life_events.map((e, i) => {
                          const label = e.description?.trim() || LIFE_EVENT_TYPE_LABEL[e.type] || e.type;
                          const text = e.date ? `${label} (${e.date})` : label;
                          return <li key={i}>{text}</li>;
                        })}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="border border-gray-200 px-2 py-1.5 bg-gray-50 text-gray-600 font-medium align-top">其他属性</td>
                  <td className={`border border-gray-200 px-2 py-1.5 align-top ${editing ? 'bg-gray-100' : 'bg-white text-gray-800'}`}>
                    {profile.attributes && Object.keys(profile.attributes).length > 0 ? (
                      <div className={`flex flex-wrap gap-2 justify-end ${editing ? 'opacity-80' : ''}`}>
                        {Object.entries(profile.attributes).map(([k, v], i) => {
                          const val = String(v ?? '');
                          const len = k.length + val.length;
                          const sizeClass = len <= 8 ? 'text-xs' : len <= 16 ? 'text-sm' : len <= 24 ? 'text-base' : 'text-lg';
                          const colors = [
                            'bg-sky-100 text-sky-800 border-sky-200',
                            'bg-violet-100 text-violet-800 border-violet-200',
                            'bg-emerald-100 text-emerald-800 border-emerald-200',
                            'bg-amber-100 text-amber-800 border-amber-200',
                            'bg-rose-100 text-rose-800 border-rose-200',
                          ];
                          const colorClass = colors[i % colors.length];
                          return (
                            <span
                              key={k}
                              title={`${k}: ${val}`}
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium ${sizeClass} ${colorClass}`}
                            >
                              {k}: {val}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className={`mt-3 pt-3 border-t border-gray-100 text-xs text-right ${editing ? 'text-gray-400 opacity-75' : 'text-gray-400'}`}>
              版本 {profile.version != null ? profile.version : '—'} · 更新时间 {formatProfileUpdatedAt(profile.updated_at)}
            </div>
          </div>
        )}
        </section>

        <section className="bg-white rounded-lg border p-4 min-w-0">
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-4 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setMeTab('memory')}
                className={`pb-2 -mb-px text-sm font-medium border-b-2 transition-colors ${meTab === 'memory' ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                记忆银河
              </button>
              <button
                type="button"
                onClick={() => setMeTab('concept')}
                className={`pb-2 -mb-px text-sm font-medium border-b-2 transition-colors ${meTab === 'concept' ? 'border-sky-500 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                概念星图
              </button>
            </div>
            {meTab === 'memory' && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="语义搜索"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-sky-300 focus:border-sky-300"
              />
              <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                <button
                  type="button"
                  onClick={() => setMemoryTypeFilter('')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${memoryTypeFilter === '' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  全部
                </button>
                {(Object.keys(MEMORY_TYPE_LABEL) as MemoryType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMemoryTypeFilter(t)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${memoryTypeFilter === t ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    style={memoryTypeFilter === t ? { backgroundColor: MEMORY_TYPE_COLOR[t] } : undefined}
                  >
                    {MEMORY_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            )}
          </div>
          {meTab === 'memory' && (
          <>
          {/* 双时效本地筛选：两行时间轴；拖动时用 ref 加 class，不触发 Me 重渲染，避免轨道长度变 */}
          <div ref={timeFilterRef} className="mb-4 space-y-4">
            <TimeRangeSlider
              extentMin={createdExtentMin}
              extentMax={createdExtentMax}
              valueStart={createdValueStart}
              valueEnd={createdValueEnd}
              label="记录时间"
              onDragStart={() => timeFilterRef.current?.classList.add('time-filter-dragging')}
              onDragEnd={() => timeFilterRef.current?.classList.remove('time-filter-dragging')}
              onChange={(start, end) => {
                const atMin = start <= createdExtentMin;
                const atMax = end >= createdExtentMax;
                if (atMin && atMax) {
                  setCreatedAfter('');
                  setCreatedBefore('');
                } else {
                  setCreatedAfter(tsToDateString(start, false));
                  setCreatedBefore(tsToDateString(end, true));
                }
              }}
            />
            {factAxisHidden ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-600 text-sm w-14 shrink-0">事实时间</span>
                <span className="text-gray-500">所有事实持续有效</span>
              </div>
            ) : (
              <TimeRangeSlider
                extentMin={factExtentMin}
                extentMax={factExtentMax}
                valueStart={factValueStart}
                valueEnd={factValueEnd}
                label="事实时间"
                onDragStart={() => timeFilterRef.current?.classList.add('time-filter-dragging')}
                onDragEnd={() => timeFilterRef.current?.classList.remove('time-filter-dragging')}
                onChange={(start, end) => {
                  const atMin = start <= factExtentMin;
                  const atMax = end >= factExtentMax;
                  if (atMin && atMax) {
                    setFactFrom('');
                    setFactTo('');
                  } else {
                    setFactFrom(tsToDateString(start, false));
                    setFactTo(tsToDateString(end, true));
                  }
                }}
              />
            )}
          </div>
        {loading && <p className="text-gray-500">加载中…</p>}
        {!loading && memories.length === 0 && <p className="text-gray-500">暂无记忆</p>}
        {!loading && memories.length > 0 && (
          <div className="relative mt-2">
            {/* 时间轴竖线：放在第一列中心，图标落在轴上 */}
            <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200 -translate-x-1/2" aria-hidden />
            <ul className="space-y-0">
              {memories.map((m) => (
                <li key={m.memory_id} className="relative flex gap-3 pb-4 last:pb-0 items-center">
                  {/* 类型图标（在轴上）+ 时间 + 记忆内容：整行垂直居中对齐 */}
                  <div className="flex items-center gap-3 shrink-0 self-center">
                    <div className="flex justify-center items-center w-8 shrink-0">
                      <MemoryTypeIcon type={m.memory_type} className="shrink-0 z-10 bg-white rounded" title={MEMORY_TYPE_LABEL[m.memory_type]} />
                    </div>
                    <div className="w-24 shrink-0 flex items-center">
                      <span className="text-xs text-gray-500 leading-tight whitespace-nowrap">
                        {formatMemoryTime(m.created_at)}
                      </span>
                    </div>
                  </div>
                  {/* 记忆内容：主行（含按钮）与展开的共激活分开展示，使收起/忘记始终贴主行 */}
                  <div className="flex-1 min-w-0 flex flex-col self-center">
                    <div className="rounded border border-gray-100 bg-gray-50/50 p-2 text-sm relative">
                      <p className={`text-gray-700 break-words ${m.metadata?.has_coactivation ? 'pr-24' : 'pr-10'}`}>
                        {(() => {
                          const text = stripMemoryContentPrefix(m.content);
                          return text.length > 200 ? `${text.slice(0, 200)}…` : text;
                        })()}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span
                          className={
                            m.metadata?.subsector != null || m.metadata?.sector != null
                              ? 'inline-flex items-center px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100'
                              : 'text-gray-400'
                          }
                        >
                          {m.metadata?.subsector != null || m.metadata?.sector != null
                            ? String(m.metadata?.subsector ?? m.metadata?.sector)
                            : '—'}
                        </span>
                        <span className="text-gray-500">
                          事实时间：{formatFactTimeRange(m.valid_from, m.valid_to ?? undefined)}
                        </span>
                      </div>
                      <div className="absolute top-1/2 right-0 -translate-y-1/2 flex items-center gap-2 shrink-0">
                        {m.metadata?.has_coactivation === true && (
                          <button
                            type="button"
                            onClick={() => handleToggleCoactivated(m.memory_id)}
                            className="text-violet-600 hover:underline text-xs"
                          >
                            {expandedCoactivatedIds.includes(m.memory_id) ? '收起' : '相关回忆'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteMemory(m.memory_id)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          忘记
                        </button>
                      </div>
                    </div>
                    {expandedCoactivatedIds.includes(m.memory_id) && (
                      <div className="mt-2 pl-2 border-l-2 border-violet-200 space-y-1.5">
                        {coactivatedRelated[m.memory_id]?.loading ? (
                          <p className="text-xs text-gray-500">加载共激活记忆…</p>
                        ) : (coactivatedRelated[m.memory_id]?.related?.length ?? 0) > 0 ? (
                          <>
                            <p className="text-xs text-gray-500 font-medium">共激活记忆（1 跳）</p>
                            {(coactivatedRelated[m.memory_id]?.related ?? []).map((r) => (
                              <div key={r.memory_id} className="space-y-1">
                                <div className="text-xs rounded border border-gray-100 bg-white/80 p-1.5 space-y-1 relative">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    {typeof (r.metadata as { strength?: number })?.strength === 'number' && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 shrink-0">
                                        强度 {Math.round((r.metadata as { strength: number }).strength * 100)}%
                                      </span>
                                    )}
                                    <p className={`text-gray-700 break-words min-w-0 flex-1 ${r.metadata?.has_coactivation ? 'pr-14' : ''}`}>
                                      {(r.content != null && String(r.content).trim())
                                        ? (stripMemoryContentPrefix(String(r.content)).length > 150
                                            ? `${stripMemoryContentPrefix(String(r.content)).slice(0, 150)}…`
                                            : stripMemoryContentPrefix(String(r.content)))
                                        : '（无正文）'}
                                    </p>
                                    {r.metadata?.has_coactivation === true && (
                                      <button
                                        type="button"
                                        onClick={() => handleToggleCoactivated(r.memory_id)}
                                        className="absolute top-1/2 right-2 -translate-y-1/2 text-violet-600 hover:underline text-xs shrink-0"
                                      >
                                        {expandedCoactivatedIds.includes(r.memory_id) ? '收起' : '相关回忆'}
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-500">
                                    {(r.metadata?.subsector != null || r.metadata?.sector != null) && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">
                                        {String(r.metadata?.subsector ?? r.metadata?.sector ?? '')}
                                      </span>
                                    )}
                                    <span>{formatMemoryTime(r.created_at)}</span>
                                    {(r.valid_from != null || r.valid_to != null) && (
                                      <span>事实时间：{formatFactTimeRange(r.valid_from ?? undefined, r.valid_to ?? undefined)}</span>
                                    )}
                                  </div>
                                </div>
                                {expandedCoactivatedIds.includes(r.memory_id) && (
                                  <div className="pl-2 border-l-2 border-violet-100 space-y-1.5">
                                    {coactivatedRelated[r.memory_id]?.loading ? (
                                      <p className="text-xs text-gray-500">加载共激活记忆…</p>
                                    ) : (coactivatedRelated[r.memory_id]?.related?.length ?? 0) > 0 ? (
                                      <>
                                        <p className="text-xs text-gray-500 font-medium">共激活记忆（再 1 跳）</p>
                                        {(coactivatedRelated[r.memory_id]?.related ?? []).map((r2) => {
                                          const text2 = (r2.content != null && String(r2.content).trim()) ? stripMemoryContentPrefix(String(r2.content)) : '';
                                          const strength2 = (r2.metadata as { strength?: number })?.strength;
                                          return (
                                            <div key={r2.memory_id} className="text-xs rounded border border-gray-100 bg-white/60 p-1.5 space-y-1">
                                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                {typeof strength2 === 'number' && (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100 shrink-0">
                                                    强度 {Math.round(strength2 * 100)}%
                                                  </span>
                                                )}
                                                <p className="text-gray-700 break-words min-w-0 flex-1">
                                                  {text2 ? (text2.length > 150 ? `${text2.slice(0, 150)}…` : text2) : '（无正文）'}
                                                </p>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-500">
                                                {(r2.metadata?.subsector != null || r2.metadata?.sector != null) && (
                                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">
                                                    {String(r2.metadata?.subsector ?? r2.metadata?.sector ?? '')}
                                                  </span>
                                                )}
                                                <span>{formatMemoryTime(r2.created_at)}</span>
                                                {(r2.valid_from != null || r2.valid_to != null) && (
                                                  <span>事实时间：{formatFactTimeRange(r2.valid_from ?? undefined, r2.valid_to ?? undefined)}</span>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </>
                                    ) : (coactivatedRelated[r.memory_id]?.related_ids?.length ?? 0) > 0 ? (
                                      <p className="text-xs text-gray-500">
                                        共激活 {coactivatedRelated[r.memory_id]!.related_ids!.length} 条，但暂无可展示的记忆。
                                      </p>
                                    ) : (
                                      <p className="text-xs text-gray-500">暂无共激活记忆。</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </>
                        ) : (coactivatedRelated[m.memory_id]?.related_ids?.length ?? 0) > 0 ? (
                          <p className="text-xs text-gray-500">
                            共激活 {coactivatedRelated[m.memory_id]!.related_ids!.length} 条，但暂无可展示的记忆（可能已删除或不可见）。
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500">
                            暂无共激活记忆。共激活关系在多次一起被检索（如语义搜索返回多条）时会自动建立。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* 分页与总数：列表模式显示分页条，搜索模式仅显示总数；双时效由后端筛选，total 即筛选后条数 */}
        {(total > 0 || memories.length > 0) && (
          <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-500">共 {total} 条</p>
            {!searchQuery.trim() && total > MEMORY_PAGE_SIZE && (() => {
              const totalPages = Math.ceil(total / MEMORY_PAGE_SIZE);
              const canPrev = memoryPage > 1;
              const canNext = memoryPage < totalPages;
              return (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canPrev}
                    onClick={() => setMemoryPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-gray-600">
                    第 {memoryPage} / {totalPages} 页
                  </span>
                  <button
                    type="button"
                    disabled={!canNext}
                    onClick={() => setMemoryPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
                  >
                    下一页
                  </button>
                </div>
              );
            })()}
          </div>
        )}
          </>
          )}
          {meTab === 'concept' && (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <input
                  type="text"
                  value={conceptQuery}
                  onChange={(e) => setConceptQuery(e.target.value)}
                  placeholder="关键词搜索（名称/描述）"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:ring-1 focus:ring-sky-300 focus:border-sky-300"
                />
                <select
                  value={conceptEntityType}
                  onChange={(e) => setConceptEntityType(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300 focus:border-sky-300 bg-white"
                >
                  <option value="">全部类型</option>
                  {Object.entries(ENTITY_TYPE_LABEL).map(([t, label]) => (
                    <option key={t} value={t}>{label}</option>
                  ))}
                </select>
              </div>
              <div ref={conceptTimeFilterRef} className="mb-4 space-y-4">
                <TimeRangeSlider
                  extentMin={conceptCreatedExtentMin}
                  extentMax={conceptCreatedExtentMax}
                  valueStart={conceptCreatedValueStart}
                  valueEnd={conceptCreatedValueEnd}
                  label="记录时间"
                  onDragStart={() => conceptTimeFilterRef.current?.classList.add('time-filter-dragging')}
                  onDragEnd={() => conceptTimeFilterRef.current?.classList.remove('time-filter-dragging')}
                  onChange={(start, end) => {
                    const atMin = start <= conceptCreatedExtentMin;
                    const atMax = end >= conceptCreatedExtentMax;
                    if (atMin && atMax) {
                      setConceptCreatedAfter('');
                      setConceptCreatedBefore('');
                    } else {
                      setConceptCreatedAfter(tsToDateString(start, false));
                      setConceptCreatedBefore(tsToDateString(end, true));
                    }
                  }}
                />
                {conceptFactAxisHidden ? (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-600 text-sm w-14 shrink-0">概念时间</span>
                    <span className="text-gray-500">所有概念持续有效</span>
                  </div>
                ) : (
                  <TimeRangeSlider
                    extentMin={conceptFactExtentMin}
                    extentMax={conceptFactExtentMax}
                    valueStart={conceptFactValueStart}
                    valueEnd={conceptFactValueEnd}
                    label="概念时间"
                    onDragStart={() => conceptTimeFilterRef.current?.classList.add('time-filter-dragging')}
                    onDragEnd={() => conceptTimeFilterRef.current?.classList.remove('time-filter-dragging')}
                    onChange={(start, end) => {
                      const atMin = start <= conceptFactExtentMin;
                      const atMax = end >= conceptFactExtentMax;
                      if (atMin && atMax) {
                        setConceptFactFrom('');
                        setConceptFactTo('');
                      } else {
                        setConceptFactFrom(tsToDateString(start, false));
                        setConceptFactTo(tsToDateString(end, true));
                      }
                    }}
                  />
                )}
              </div>
              {conceptLoading && <p className="text-gray-500">加载中…</p>}
              {!conceptLoading && conceptTotal === 0 && <p className="text-gray-500">暂无实体</p>}
              {!conceptLoading && conceptTotal > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">共 {conceptTotal} 条</p>
                  <ConceptRelationGraph entities={conceptEntitiesRaw} relations={conceptRelations} entityTypeLabel={ENTITY_TYPE_LABEL} />
                  <div className="border-t border-gray-100 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConceptListExpanded((v) => !v);
                          if (!conceptListExpanded) setConceptDetailPage(1);
                        }}
                        className="text-sm text-sky-600 hover:underline"
                      >
                        {conceptListExpanded ? '收起' : '查看详情'}
                      </button>
                      {conceptListExpanded && conceptTotal > MEMORY_PAGE_SIZE && (() => {
                        const totalDetailPages = Math.ceil(conceptTotal / MEMORY_PAGE_SIZE);
                        const canPrevDetail = conceptDetailPage > 1;
                        const canNextDetail = conceptDetailPage < totalDetailPages;
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">共 {conceptTotal} 条</span>
                            <button
                              type="button"
                              disabled={!canPrevDetail}
                              onClick={() => setConceptDetailPage((p) => Math.max(1, p - 1))}
                              className="px-2.5 py-1 text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
                            >
                              上一页
                            </button>
                            <span className="text-sm text-gray-600">
                              第 {conceptDetailPage} / {totalDetailPages} 页
                            </span>
                            <button
                              type="button"
                              disabled={!canNextDetail}
                              onClick={() => setConceptDetailPage((p) => Math.min(totalDetailPages, p + 1))}
                              className="px-2.5 py-1 text-sm text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
                            >
                              下一页
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                    {conceptListExpanded && (() => {
                      const detailStart = (conceptDetailPage - 1) * MEMORY_PAGE_SIZE;
                      const detailSlice = conceptEntities.slice(detailStart, detailStart + MEMORY_PAGE_SIZE);
                      return (
                        <ul className="mt-2 space-y-1.5 min-h-[32rem]">
                          {detailSlice.map((e) => (
                            <li key={e.entity_id} className="rounded border border-gray-100 bg-gray-50/50 px-2 py-1.5 text-sm flex items-center gap-2 min-w-0">
                              <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100 text-xs">
                                {ENTITY_TYPE_LABEL[e.entity_type] ?? e.entity_type}
                              </span>
                              <span className="shrink-0 font-medium text-gray-800 truncate max-w-[8rem]" title={e.name}>{e.name}</span>
                              <span className="min-w-0 flex-1 text-gray-600 text-xs truncate" title={(e.properties?.description ?? e.properties?.value ?? e.properties?.name) != null ? String(e.properties?.description ?? e.properties?.value ?? e.properties?.name) : ''}>
                                {(e.properties?.description ?? e.properties?.value ?? e.properties?.name) != null
                                  ? String(e.properties?.description ?? e.properties?.value ?? e.properties?.name ?? '')
                                  : '—'}
                              </span>
                              <span className="shrink-0 text-gray-400 text-xs whitespace-nowrap">
                                记录时间：{formatMemoryTime(e.transaction_time)}
                                {e.valid_from && ` · 概念时间：${formatFactTimeRange(e.valid_from, e.valid_to ?? undefined)}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
