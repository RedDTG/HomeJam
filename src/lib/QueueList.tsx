"use client";

import type { QueueItem } from "./types";
import { placeholder } from "./constants";
import { label } from "./helpers";

type Props = {
  items: QueueItem[];
  admin: boolean;
  onRemove?: (id: string) => void;
};

export function QueueList({ items, admin, onRemove }: Props) {
  if (!items.length) return <p className="empty">Aucun morceau en attente.</p>;
  return (
    <div className="queue">
      {items.map((item) => (
        <article key={item.id} className="queue-item">
          <img src={item.track.artwork || placeholder} alt="" />
          <div>
            <strong>{item.track.title}</strong>
            <span>
              {item.track.artist} - {label(item)}
            </span>
          </div>
          {admin && onRemove ? (
            <button className="ghost" onClick={() => onRemove(item.id)}>
              Retirer
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
