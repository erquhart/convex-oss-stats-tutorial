import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const App = () => {
  const owner = useQuery(api.stats.getGithubOwnerStats, { owner: "tanstack" });

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(to right, #f8f9fa, #e9ecef)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "40px",
          padding: "40px",
          background: "white",
          borderRadius: "12px",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        }}
      >
        <StatDisplay label="Stars" value={owner?.starCount} />
        <StatDisplay label="Dependencies" value={owner?.dependentCount} />
        <StatDisplay label="Contributors" value={owner?.contributorCount} />
      </div>
    </div>
  );
};

const StatDisplay = ({ label, value }: { label: string; value?: number }) => (
  <div style={{ minWidth: "200px", padding: "20px" }}>
    <div
      style={{
        fontSize: "18px",
        fontFamily: "sans-serif",
        color: "#6c757d",
        marginBottom: "8px",
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: "36px",
        fontWeight: "bold",
        color: "#212529",
        fontFamily: "sans-serif",
      }}
    >
      {value?.toLocaleString()}
    </div>
  </div>
);

export default App;
