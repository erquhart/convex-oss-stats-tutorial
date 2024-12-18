import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const App = () => {
  const result = useQuery(api.foo.get);
  return <h1>Hello World</h1>;
};

export default App;
