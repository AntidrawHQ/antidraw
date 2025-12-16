import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppCanvas } from "./Canvas";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppCanvas />
    </QueryClientProvider>
  );
}

export default App;
