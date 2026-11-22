import { Ionicons } from "@expo/vector-icons";
import {
  getGujaratLocationById,
  searchGujaratLocations,
  type GujaratLocation,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

const POPULAR_ORIGIN_IDS = [
  "ahmedabad-city",
  "vadodara-city",
  "surat-city",
  "anand-city",
  "rajkot-city",
  "kutch-bhuj",
] as const;

function ResultSeparator() {
  return <View style={styles.separator} />;
}

type GujaratAutocompleteCardProps = {
  neighborhoodLabel: string;
  selectedOrigin: GujaratLocation | null;
  onSelectOrigin: (origin: GujaratLocation) => void;
  onEditNeighborhood: () => void;
};

export function GujaratAutocompleteCard({
  neighborhoodLabel,
  selectedOrigin,
  onSelectOrigin,
  onEditNeighborhood,
}: GujaratAutocompleteCardProps) {
  const [query, setQuery] = useState("");
  const { height: windowHeight } = useWindowDimensions();
  const listMaxHeight = Math.min(205, Math.max(110, Math.round(windowHeight * 0.24)));

  const popularOrigins = useMemo(
    () =>
      POPULAR_ORIGIN_IDS.map((id) => getGujaratLocationById(id)).filter(
        (item): item is GujaratLocation => item !== undefined,
      ),
    [],
  );

  const results = useMemo(() => searchGujaratLocations(query, 12), [query]);

  function handlePick(origin: GujaratLocation) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectOrigin(origin);
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>STEP 2 OF 2 · GUJARAT ROOTS</Text>
        <Pressable style={styles.backChip} onPress={onEditNeighborhood}>
          <Ionicons name="pencil" size={11} color="#0F766E" />
          <Text style={styles.backChipText}>Near {neighborhoodLabel}</Text>
        </Pressable>
      </View>

      <Text style={styles.title}>Where in Gujarat is home?</Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color="#64748B" />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search city, taluka, or area (e.g. Alkapuri, Baroda, Vesu)"
          placeholderTextColor="#94A3B8"
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </Pressable>
        ) : null}
      </View>

      {query.trim().length === 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.quickChipsRow}
        >
          {popularOrigins.map((loc) => {
            const active = selectedOrigin?.id === loc.id;
            return (
              <Pressable
                key={loc.id}
                style={[styles.quickChip, active && styles.quickChipActive]}
                onPress={() => handlePick(loc)}
              >
                <Text style={[styles.quickChipText, active && styles.quickChipTextActive]}>
                  {loc.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        style={[styles.resultsList, { maxHeight: listMaxHeight }]}
        ItemSeparatorComponent={ResultSeparator}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No matching Gujarat district, city, or neighborhood found.
          </Text>
        }
        renderItem={({ item }) => {
          const isSelected = selectedOrigin?.id === item.id;
          return (
            <Pressable
              style={[styles.resultRow, isSelected && styles.resultRowSelected]}
              onPress={() => handlePick(item)}
            >
              <View style={styles.resultTextCol}>
                <Text style={[styles.resultName, isSelected && styles.resultNameSelected]}>
                  {item.name}
                </Text>
                <Text style={styles.resultSub}>{item.displayName}</Text>
              </View>
              <View style={[styles.typeBadge, isSelected && styles.typeBadgeSelected]}>
                <Text style={[styles.typeBadgeText, isSelected && styles.typeBadgeTextSelected]}>
                  {item.type}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexShrink: 1,
    backgroundColor: "rgba(255, 255, 255, 0.97)",
    borderRadius: 22,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#0F766E",
  },
  backChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F0FDFA",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  backChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0F766E",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#0F172A",
    paddingVertical: 0,
  },
  quickChipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  quickChip: {
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickChipActive: {
    backgroundColor: "#0F766E",
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  quickChipTextActive: {
    color: "#FFFFFF",
  },
  resultsList: {
    flexShrink: 1,
  },
  separator: {
    height: 1,
    backgroundColor: "#F1F5F9",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    gap: 10,
  },
  resultRowSelected: {
    backgroundColor: "#F0FDFA",
  },
  resultTextCol: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  resultNameSelected: {
    color: "#0F766E",
  },
  resultSub: {
    fontSize: 12,
    color: "#64748B",
  },
  typeBadge: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeSelected: {
    backgroundColor: "#CCFBF1",
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    color: "#475569",
  },
  typeBadgeTextSelected: {
    color: "#0F766E",
  },
  emptyText: {
    paddingVertical: 16,
    textAlign: "center",
    fontSize: 13,
    color: "#64748B",
  },
});
