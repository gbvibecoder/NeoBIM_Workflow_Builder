"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import s from "./settings.module.css";

interface ApiKeyRowProps {
  stripNum: string;
  stripLabel: string;
  icon: React.ReactNode;
  name: string;
  tagline: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled: boolean;
}

export function ApiKeyRow({
  stripNum,
  stripLabel,
  icon,
  name,
  tagline,
  value,
  onChange,
  placeholder,
  disabled,
}: ApiKeyRowProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={s.keyRow}>
      <div className={s.keyRowStrip}>
        <span className={s.keyRowStripNum}>{stripNum} &middot; {stripLabel}</span>
      </div>
      <div className={s.keyRowBody}>
        <div className={s.keyRowHead}>
          <div className={s.keyRowInfo}>
            <div className={s.keyRowIcon}>{icon}</div>
            <div>
              <div className={s.keyRowName}>{name}</div>
              <div className={s.keyRowTagline}>{tagline}</div>
            </div>
          </div>
        </div>
        <div className={s.keyRowInputWrap}>
          <input
            type={visible ? "text" : "password"}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={s.keyRowInput}
          />
          <button
            className={s.keyRowInputToggle}
            onClick={() => setVisible(!visible)}
            type="button"
            title={visible ? "Hide" : "Show"}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
