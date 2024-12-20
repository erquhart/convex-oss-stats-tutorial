import NumberFlow from "@number-flow/react";

export const StableCounter = ({ value }: { value?: number }) => {
  if (typeof value !== "number") {
    return null;
  }
  const dummyString = Number(
    Array(value?.toString().length ?? 1)
      .fill("8")
      .join(""),
  ).toLocaleString();

  return (
    <div style={{ position: "relative" }}>
      {/* Dummy span to prevent layout shift */}
      <span style={{ opacity: 0 }}>{dummyString}</span>
      <span style={{ position: "absolute", top: "-0.5px", left: 0 }}>
        <NumberFlow
          transformTiming={{
            duration: 1000,
            easing: "linear",
          }}
          value={value}
          trend={1}
          continuous
          isolate
          willChange
        />
      </span>
    </div>
  );
};
