import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { DonationService, OrganizationStats, Donation, DonationArticle, StatusDonation } from '../../../core/services/donation.service';
import { AuthService, User } from '../../../core/services/auth.service';
import { OrganizationProfileService, OrganizationProfile } from '../../../core/services/organization-profile.service';
import { ToastService } from '../../../core/services/toast.service';

type TabType = 'resumen' | 'mis-donaciones' | 'donadas-a-mi' | 'solicitudes';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './organization-dashboard.component.html',
  styleUrls: ['./organization-dashboard.component.scss']
})
export class OrganizationDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  // Estado de pestañas con BehaviorSubject
  private activeTabSubject = new BehaviorSubject<TabType>('resumen');
  public activeTab$ = this.activeTabSubject.asObservable();
  
  currentUser: User | null = null;
  organizationProfile: OrganizationProfile | null = null;
  stats: OrganizationStats | null = null;
  // Keep a copy of all loaded donations so we can derive tab-specific views
  allDonations: Donation[] = [];
  donations: Donation[] = [];
  filteredDonations: Donation[] = [];
  recentDonations: Donation[] = [];
  loading = true;
  loadingDonations = false;
  loadingSolicitudes = false;
  errorMessage = '';

  // Solicitudes donde soy donador
  solicitudes: Donation[] = [];

  // Filtros (cliente)
  filters: {
    search: string;
    status: string; // usa el texto normalizado de getStatusBadge (e.g., 'Pendiente', 'Entregada') o 'all'
    location: string; // lugar de recogida o donación
    article: string; // nombre de artículo
    dateFrom: string | null; // 'YYYY-MM-DD'
    dateTo: string | null;   // 'YYYY-MM-DD'
  } = {
    search: '',
    status: 'all',
    location: 'all',
    article: 'all',
    dateFrom: null,
    dateTo: null,
  };

  // Opciones derivadas
  statusOptions: string[] = [];
  locationOptions: string[] = [];
  articleOptions: string[] = [];
  // Catálogo de estados (backend)
  statusCatalog: StatusDonation[] = [];
  // Mapa de carga al actualizar estado
  updatingStatus: Record<number, boolean> = {};

  // Paginación
  page = 1;
  pageSize = 9;
  totalPages = 1;
  pagedDonations: Donation[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private donationService: DonationService,
    private authService: AuthService,
    private organizationProfileService: OrganizationProfileService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        // If donations already loaded, re-apply tab filtering that may depend on currentUser
        this.applyTabFilteringIfNeeded();
      });

    // Cargar perfil de la organización
    this.loadOrganizationProfile();
    // Leer query param 'section' y actualizar pestaña activa
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const section = params['section'];
      // page may be present in query params; default to 1
      const pageParam = params['page'];
      const parsedPage = parseInt(pageParam, 10);
      this.page = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;

      let tab: TabType = 'resumen'; // default
      if (section === 'myDonations') tab = 'mis-donaciones';
      else if (section === 'requests') tab = 'solicitudes';
      else if (section === 'donatedToMe') tab = 'donadas-a-mi';
      else if (section === 'overview') tab = 'resumen';

      this.activeTabSubject.next(tab);
    });

    // Cargar datos iniciales
    this.loadStats();
    this.loadStatusCatalog();
    this.loadRecentDonations();
    // Precalcular solicitudes después de cargar (cuando se entra a ese tab)
    this.loadAllDonations();

    // Suscribirse a cambios de pestaña
    this.activeTab$.pipe(takeUntil(this.destroy$)).subscribe(tab => {
      // When switching to tabs that require the full donations list, ensure we have it
      if ((tab === 'mis-donaciones' || tab === 'donadas-a-mi' || tab === 'solicitudes') && this.allDonations.length === 0) {
        this.loadAllDonations();
      } else {
        // If we already have donations loaded, re-apply any tab-specific filtering
        this.applyTabFilteringIfNeeded();
      }

      if (tab === 'solicitudes') {
        this.computeSolicitudes();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Cargar estadísticas de la organización
   */
  loadStats(): void {
    this.loading = true;
    this.errorMessage = '';

    this.donationService.getOrganizationStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.stats = stats;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error al cargar estadísticas:', error);
          this.errorMessage = 'Error al cargar las estadísticas. Por favor, intenta de nuevo.';
          this.loading = false;
        }
      });
  }

  /**
   * Cargar donaciones recientes (últimas 3)
   */
  loadRecentDonations(): void {
    this.donationService.getMyDonations()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (donations) => {
          // Ordenar por fecha de creación (más recientes primero) y tomar las últimas 3
          this.recentDonations = donations
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 3);
        },
        error: (error) => {
          console.error('Error al cargar donaciones recientes:', error);
        }
      });
  }

  /**
   * Cargar todas las donaciones
   */
  loadAllDonations(): void {
    this.loadingDonations = true;
    this.donationService.getMyDonations()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (donations) => {
          // Keep a full copy and apply tab-specific filtering later
          this.allDonations = donations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          // Apply tab-specific selection (may depend on currentUser)
          this.applyTabFilteringIfNeeded();
          // Construir opciones y aplicar filtros sobre the currently selected this.donations
          this.buildFilterOptions();
          this.applyFilters();
          this.loadingDonations = false;
          // Recalcular solicitudes
          this.computeSolicitudes();
        },
        error: (error) => {
          console.error('Error al cargar donaciones:', error);
          this.loadingDonations = false;
        }
      });
  }

  /**
   * Apply a tab-specific filter to `this.allDonations` and populate `this.donations`.
   * This keeps the rest of the filtering/pagination logic unchanged because it
   * always operates against `this.donations`.
   */
  private applyTabFilteringIfNeeded(): void {
    // Default to showing all donations
    let list = Array.isArray(this.allDonations) ? [...this.allDonations] : [];

    if (this.activeTab === 'donadas-a-mi' && this.currentUser) {
      const myId = (this.currentUser.id || '').toString();
      list = list.filter(d => (d.beneficiary?.id || '').toString() === myId);
    }

    // For other tabs we keep the full list; assign to this.donations for downstream filters
    this.donations = list;
  }

  /**
   * Calcular solicitudes donde el usuario autenticado es el donador
   */
  private computeSolicitudes(): void {
    if (!this.currentUser) { this.solicitudes = []; return; }
    this.loadingSolicitudes = true;
    const myId = (this.currentUser.id || '').toString();
    this.solicitudes = (this.donations || []).filter(d => (d.donator?.id || '').toString() === myId);
    this.loadingSolicitudes = false;
  }

  /**
   * Cargar catálogo de estados desde backend
   */
  private loadStatusCatalog(): void {
    this.donationService.getAllDonationStatuses()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (statuses) => {
          this.statusCatalog = statuses;
          // Mapear a textos normalizados (coinciden con getStatusBadge)
          const texts = statuses.map(s => this.getStatusBadge({ status: s.status }).text);
          this.statusOptions = Array.from(new Set(texts)).sort();
        },
        error: (err) => {
          console.error('Error al obtener estados de donación:', err);
        }
      });
  }

  /**
   * Cambiar pestaña activa
   */
  setActiveTab(tab: TabType): void {
    this.activeTabSubject.next(tab);
    // Actualizar query param según la pestaña
    let sectionParam = 'overview';
    if (tab === 'mis-donaciones') sectionParam = 'myDonations';
    else if (tab === 'donadas-a-mi') sectionParam = 'donatedToMe';
    else if (tab === 'solicitudes') sectionParam = 'requests';
    // Reset page to 1 when switching tabs for a consistent starting point
    this.page = 1;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section: sectionParam, page: this.page },
      queryParamsHandling: 'merge'
    });
  }

  /**
   * Obtener pestaña activa actual
   */
  get activeTab(): TabType {
    return this.activeTabSubject.value;
  }

  /**
   * Navegar a crear nueva donación
   */
  onCreateDonation(): void {
    this.router.navigate(['/organization/donations/create']);
  }

  /**
   * Navegar al detalle de una donación
   */
  viewDonation(donationId: number): void {
    this.router.navigate(['/organization/donations', donationId]);
  }

  /**
   * Limpiar mensaje de error
   */
  clearError(): void {
    this.errorMessage = '';
  }

  /**
   * Cargar perfil de la organización
   */
  loadOrganizationProfile(): void {
    this.organizationProfileService.getMyOrganizationProfile()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (profile) => {
          this.organizationProfile = profile;
        },
        error: (error) => {
          console.error('Error al cargar perfil de organización:', error);
        }
      });
  }

  /**
   * Construir opciones de filtros a partir de las donaciones cargadas
   */
  private buildFilterOptions(): void {
    const statusSet = new Set<string>();
    const locationSet = new Set<string>();
    const articleSet = new Set<string>();

    for (const d of this.donations) {
      // Status normalizado a como se muestra en badge
      const badge = this.getStatusBadge(d.statusDonation);
      if (badge?.text) statusSet.add(badge.text);

      // Lugares
      if (d.lugarRecogida) locationSet.add(d.lugarRecogida.trim());
      if ((d as any).lugarDonacion) {
        const ld = (d as any).lugarDonacion;
        if (ld) locationSet.add(String(ld).trim());
      }

      // Artículos
      if (d.articles && d.articles.length > 0) {
        for (const a of d.articles) {
          if (a?.article?.name) articleSet.add(a.article.name.trim());
        }
      }
    }

    this.statusOptions = Array.from(statusSet).sort();
    this.locationOptions = Array.from(locationSet).sort();
    this.articleOptions = Array.from(articleSet).sort();
  }

  /**
   * Aplicar filtros en cliente
   */
  applyFilters(): void {
    const search = this.filters.search.trim().toLowerCase();
    const statusSel = this.filters.status;
    const locSel = this.filters.location;
    const artSel = this.filters.article;
    const from = this.filters.dateFrom ? new Date(this.filters.dateFrom + 'T00:00:00') : null;
    const to = this.filters.dateTo ? new Date(this.filters.dateTo + 'T23:59:59') : null;

  this.filteredDonations = this.donations.filter(d => {
      // Status
      if (statusSel !== 'all') {
        const badge = this.getStatusBadge(d.statusDonation);
        if (badge.text !== statusSel) return false;
      }

      // Location
      if (locSel !== 'all') {
        const lr = (d.lugarRecogida || '').toString().trim();
        const ld = ((d as any).lugarDonacion || '').toString().trim();
        if (lr !== locSel && ld !== locSel) return false;
      }

      // Article name
      if (artSel !== 'all') {
        const names = (d.articles || []).map(a => a?.article?.name?.trim()).filter(Boolean);
        if (!names.includes(artSel)) return false;
      }

      // Date range (createdAt)
      if (from || to) {
        const created = new Date(d.createdAt);
        if (from && created < from) return false;
        if (to && created > to) return false;
      }

      // Search across title, locations, articles
      if (search) {
        const title = (d.post?.title || '').toString().toLowerCase();
        const lr = (d.lugarRecogida || '').toString().toLowerCase();
        const ld = ((d as any).lugarDonacion || '').toString().toLowerCase();
        const arts = (d.articles || []).map(a => a?.article?.name?.toLowerCase()).filter(Boolean).join(' ');
        const creator = (d.user?.username || '').toLowerCase();
        const beneficiary = (d.beneficiary?.username || '').toLowerCase();
        const donator = (d.donator?.username || '').toLowerCase();
        const haystack = `${title} ${lr} ${ld} ${arts} ${creator} ${beneficiary} ${donator}`;
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
    this.updatePagination();
  }

  /**
   * Limpiar filtros
   */
  clearFilters(): void {
    this.filters = {
      search: '',
      status: 'all',
      location: 'all',
      article: 'all',
      dateFrom: null,
      dateTo: null,
    };
    this.page = 1;
    this.applyFilters();
  }

  /** Paginación en cliente */
  updatePagination(): void {
    this.totalPages = Math.max(1, Math.ceil(this.filteredDonations.length / this.pageSize));
    if (this.page > this.totalPages) this.page = this.totalPages;
    if (this.page < 1) this.page = 1;
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.pagedDonations = this.filteredDonations.slice(start, end);
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.updatePagination();
    // push page into the url so back/forward preserves it
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: this.page },
      queryParamsHandling: 'merge'
    });
  }

  prevPage(): void {
    if (this.page > 1) {
      this.goToPage(this.page - 1);
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.goToPage(this.page + 1);
    }
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  /** Permisos para cambiar estado */
  canChangeStatus(d: Donation): boolean {
    const isAdmin = this.currentUser?.role === 'admin';
    const isOwnerFlag = (d as any).owner === true;
    const isCreator = (d.user?.id?.toString() || '') === (this.currentUser?.id?.toString() || '');
    return isAdmin || isOwnerFlag || isCreator;
  }

  /** Cambiar estado de una donación */
  async onChangeDonationStatus(donation: Donation, newStatusId: string | number): Promise<void> {
    const statusId = typeof newStatusId === 'string' ? parseInt(newStatusId, 10) : newStatusId;
    if (!statusId || isNaN(statusId as number)) return;
    try {
      this.updatingStatus[donation.id] = true;
      const updated = await this.donationService.updateDonationStatus(donation.id, { status: statusId as number }).toPromise();
      if (updated) {
        const idx = this.donations.findIndex(x => x.id === donation.id);
        if (idx !== -1) this.donations[idx] = updated;
        const idxF = this.filteredDonations.findIndex(x => x.id === donation.id);
        if (idxF !== -1) this.filteredDonations[idxF] = updated;
        const idxP = this.pagedDonations.findIndex(x => x.id === donation.id);
        if (idxP !== -1) this.pagedDonations[idxP] = updated;
        this.toast.success('Estado actualizado', `La donación #${donation.id} ahora está en estado "${this.getStatusBadge(updated.statusDonation).text}"`);
        this.applyFilters();
      }
    } catch (err) {
      console.error('Error al cambiar estado de donación:', err);
      this.toast.error('No se pudo actualizar', 'Intenta nuevamente en unos segundos.');
    } finally {
      this.updatingStatus[donation.id] = false;
    }
  }

  /**
   * Obtener nombre de la organización
   */
  get organizationName(): string {
    // Usar el nombre de la organización del perfil, no el username
    return this.organizationProfile?.name || this.currentUser?.name || 'Organización';
  }

  /**
   * Formatear fecha
   */
  formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Obtener badge de estado
   */
  getStatusBadge(statusDonation: any): { text: string; class: string } {
    // Si es null o undefined
    if (!statusDonation) {
      return { text: 'Disponible', class: 'bg-green-100 text-green-800' };
    }
    
    // Si es un objeto con propiedad status (respuesta del backend)
    if (typeof statusDonation === 'object' && statusDonation.status) {
      const status = statusDonation.status.toLowerCase().trim();
      switch (status) {
        case 'pendiente':
          return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
        case 'aceptada':
          return { text: 'Aceptada', class: 'bg-green-100 text-green-800' };
        case 'rechazada':
          return { text: 'Rechazada', class: 'bg-red-100 text-red-800' };
        case 'entregada':
          return { text: 'Entregada', class: 'bg-blue-100 text-blue-800' };
        case 'cancelada':
          return { text: 'Cancelada', class: 'bg-gray-200 text-gray-700' };
        case 'en progreso':
          return { text: 'En Progreso', class: 'bg-indigo-100 text-indigo-800' };
        case 'completada':
          return { text: 'Completada', class: 'bg-blue-100 text-blue-800' };
        case 'recogida':
        case 'recogida ':
          return { text: 'Recogida', class: 'bg-emerald-100 text-emerald-800' };
        case 'en camino':
          return { text: 'En Camino', class: 'bg-purple-100 text-purple-800' };
        case 'en espera':
          return { text: 'En Espera', class: 'bg-orange-100 text-orange-800' };
        case 'recibida':
          return { text: 'Recibida', class: 'bg-teal-100 text-teal-800' };
        default:
          return { text: statusDonation.status, class: 'bg-gray-100 text-gray-800' };
      }
    }
    
    // Si es un número, convertir a texto
    if (typeof statusDonation === 'number') {
      switch (statusDonation) {
        case 1:
          return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
        case 2:
          return { text: 'Aceptada', class: 'bg-green-100 text-green-800' };
        case 3:
          return { text: 'Rechazada', class: 'bg-red-100 text-red-800' };
        case 4:
          return { text: 'Entregada', class: 'bg-blue-100 text-blue-800' };
        default:
          return { text: `Estado ${statusDonation}`, class: 'bg-gray-100 text-gray-800' };
      }
    }
    
    // Si es string
  const statusStr = String(statusDonation);
  const status = statusStr.toLowerCase().trim();
    
    switch (status) {
      case 'pendiente':
        return { text: 'Pendiente', class: 'bg-yellow-100 text-yellow-800' };
      case 'aceptada':
      case 'disponible':
        return { text: 'Disponible', class: 'bg-green-100 text-green-800' };
      case 'rechazada':
        return { text: 'Rechazada', class: 'bg-red-100 text-red-800' };
      case 'entregada':
        return { text: 'Entregada', class: 'bg-blue-100 text-blue-800' };
      case 'completada':
        return { text: 'Completada', class: 'bg-blue-100 text-blue-800' };
      case 'cancelada':
        return { text: 'Cancelada', class: 'bg-gray-200 text-gray-700' };
      case 'en progreso':
        return { text: 'En Progreso', class: 'bg-indigo-100 text-indigo-800' };
      case 'recogida':
      case 'recogida ':
        return { text: 'Recogida', class: 'bg-emerald-100 text-emerald-800' };
      case 'en camino':
        return { text: 'En Camino', class: 'bg-purple-100 text-purple-800' };
      case 'en espera':
        return { text: 'En Espera', class: 'bg-orange-100 text-orange-800' };
      case 'recibida':
        return { text: 'Recibida', class: 'bg-teal-100 text-teal-800' };
      default:
        return { text: statusStr, class: 'bg-gray-100 text-gray-800' };
    }
  }

  /**
   * Obtener resumen de artículos
   */
  getArticlesSummary(articles: DonationArticle[]): string {
    if (!articles || articles.length === 0) {
      return 'Sin artículos';
    }
    
    const totalItems = articles.reduce((sum, article) => sum + parseInt(article.quantity), 0);
    const articleNames = articles.slice(0, 2).map(a => a.article.name).join(', ');
    
    if (articles.length > 2) {
      return `${articleNames} y ${articles.length - 2} más (${totalItems} artículos)`;
    }
    
    return `${articleNames} (${totalItems} artículos)`;
  }

}
