import { jsx } from "hono/jsx";

export function formatCodeWithSpacer(code: string, segments: number[]) {
  if (!code || !segments?.length) return code;

  let result = [];
  let currentPos = 0;
  
  for (const segmentSize of segments) {
    if (currentPos >= code.length) break;
    const segment = code.slice(currentPos, currentPos + segmentSize);
    result.push(segment);
    currentPos += segmentSize;
  }

  // Add remaining characters as last segment
  if (currentPos < code.length) {
    result.push(code.slice(currentPos));
  }

  return (
    <>
      {result.map((segment, i) => (
        <>
          {segment}
          {i < result.length - 1 && <span className="code-spacer" />}
        </>
      ))}
    </>
  );
}
