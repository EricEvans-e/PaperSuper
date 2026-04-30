import { Rnd } from "react-rnd";
import { useRef } from "react";
import { getPageFromElement } from "../lib/pdfjs-dom";
import styles from "../style/AreaHighlight.module.css";
import type { LTWHP, ViewportHighlight } from "../types";

interface Props {
  highlight: ViewportHighlight;
  onChange: (rect: LTWHP) => void;
  onClick?: (event: MouseEvent) => void;
  isScrolledTo: boolean;
}

export function AreaHighlight({
  highlight,
  onChange,
  onClick,
  isScrolledTo,
  ...otherProps
}: Props) {
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className={`${styles.areaHighlight} ${
        isScrolledTo ? styles.scrolledTo : ""
      }`}
    >
      <Rnd
        className={styles.part}
        onDragStop={(_, data) => {
          const boundingRect: LTWHP = {
            ...highlight.position.boundingRect,
            top: data.y,
            left: data.x,
          };
          onChange(boundingRect);
        }}
        onResizeStop={(_mouseEvent, _direction, ref, _delta, position) => {
          const boundingRect: LTWHP = {
            top: position.y,
            left: position.x,
            width: ref.offsetWidth,
            height: ref.offsetHeight,
            pageNumber: getPageFromElement(ref)?.number || -1,
          };
          onChange(boundingRect);
        }}
        position={{
          x: highlight.position.boundingRect.left,
          y: highlight.position.boundingRect.top,
        }}
        size={{
          width: highlight.position.boundingRect.width,
          height: highlight.position.boundingRect.height,
        }}
        onMouseDown={(event: MouseEvent) => {
          if (!onClick) {
            return;
          }

          clickStartRef.current = {
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onMouseUp={(event: MouseEvent) => {
          if (!onClick || !clickStartRef.current) {
            return;
          }

          const movedX = Math.abs(event.clientX - clickStartRef.current.x);
          const movedY = Math.abs(event.clientY - clickStartRef.current.y);
          clickStartRef.current = null;

          if (movedX <= 3 && movedY <= 3) {
            onClick(event);
          }
        }}
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          event.preventDefault();
        }}
        {...otherProps}
      />
    </div>
  );
}
