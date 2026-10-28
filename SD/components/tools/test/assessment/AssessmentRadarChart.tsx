import React, { useId } from 'react';

import { buildRadarPoints, pointsAttribute, radarPoint } from './radarGeometry';
import type { AssessmentDimension } from './types';

interface AssessmentRadarChartProps {
  title: string;
  dimensions: AssessmentDimension[];
  scores: Record<string, number | null>;
  accentColor: string;
}

const CENTER = 160;
const RADIUS = 105;

export function AssessmentRadarChart({
  title,
  dimensions,
  scores,
  accentColor,
}: AssessmentRadarChartProps) {
  const titleId = useId();
  const descriptionId = useId();
  const values = dimensions.map((dimension) => scores[dimension.id]);
  const dataPoints = buildRadarPoints(values, CENTER, RADIUS);
  const description = dimensions
    .map((dimension) => {
      const value = scores[dimension.id];
      return `${dimension.label}：${value === null ? '信息不足' : `${value}%`}`;
    })
    .join('；');

  return (
    <svg
      viewBox="0 0 320 340"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="mx-auto block h-auto w-full max-w-[520px]"
    >
      <title id={titleId}>{`${title}维度雷达图`}</title>
      <desc id={descriptionId}>{description}</desc>

      {[25, 50, 75, 100].map((level) => (
        <polygon
          key={level}
          points={pointsAttribute(
            buildRadarPoints(dimensions.map(() => level), CENTER, RADIUS),
          )}
          fill="none"
          stroke="#ddc8af"
          strokeWidth={level === 100 ? 1.5 : 1}
        />
      ))}

      {dimensions.map((dimension, index) => {
        const endpoint = radarPoint(index, dimensions.length, 100, CENTER, RADIUS);
        return (
          <line
            key={dimension.id}
            x1={CENTER}
            y1={CENTER}
            x2={endpoint.x}
            y2={endpoint.y}
            stroke="#cdb89f"
            strokeWidth="1"
            strokeDasharray={scores[dimension.id] === null ? '4 4' : undefined}
          />
        );
      })}

      <polygon
        points={pointsAttribute(dataPoints)}
        fill={accentColor}
        fillOpacity="0.2"
        stroke={accentColor}
        strokeWidth="2.5"
        className="transition-all duration-700 motion-reduce:transition-none"
      />

      {dataPoints.map((point, index) => scores[dimensions[index].id] !== null && (
        <circle
          key={dimensions[index].id}
          cx={point.x}
          cy={point.y}
          r="4"
          fill={dimensions[index].color}
          stroke="white"
          strokeWidth="2"
          aria-hidden="true"
        />
      ))}

      {dimensions.map((dimension, index) => {
        const labelPoint = radarPoint(index, dimensions.length, 100, CENTER, 132);
        const textAnchor = labelPoint.x < CENTER - 12
          ? 'start'
          : labelPoint.x > CENTER + 12
            ? 'end'
            : 'middle';
        const value = scores[dimension.id];
        return (
          <text
            key={dimension.id}
            x={labelPoint.x}
            y={labelPoint.y}
            textAnchor={textAnchor}
            className="fill-[#5f4c3a] text-[11px] font-bold"
          >
            <tspan x={labelPoint.x} dy="0">{dimension.label}</tspan>
            <tspan
              x={labelPoint.x}
              dy="15"
              className="fill-[#8b735c] font-medium"
            >
              {value === null ? '信息不足' : `${value}%`}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
