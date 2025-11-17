import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ReportService, Report, ReportFilters } from '../../../core/services/report.service';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss']
})
export class ReportsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  reports: Report[] = [];
  loading = false;
  loadingMore = false;
  errorMessage = '';
  showDetailsModal = false;
  selectedReport: Report | null = null;

  // Filtros
  filterForm!: FormGroup;
  showFilters = false;
  currentCursor: string | undefined;
  hasMore = false;

  // Opciones de ordenamiento
  orderByOptions = [
    { value: 'username', label: 'Usuario' },
    { value: 'createdAt', label: 'Fecha de Creación' },
    { value: 'updatedAt', label: 'Fecha de Actualización' }
  ];

  orderOptions = [
    { value: 'ASC', label: 'Ascendente' },
    { value: 'DESC', label: 'Descendente' }
  ];

  constructor(
    private reportService: ReportService,
    private fb: FormBuilder
  ) {
    this.initFilterForm();
  }

  ngOnInit(): void {
    this.loadReports();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  initFilterForm(): void {
    this.filterForm = this.fb.group({
      limit: [10],
      search: [''],
      orderBy: ['username'],
      order: ['ASC']
    });
  }

  /**
   * Cargar reportes
   */
  loadReports(cursor?: string): void {
    if (cursor) {
      this.loadingMore = true;
    } else {
      this.loading = true;
      this.reports = []; // Limpiar lista al cargar nuevos
    }
    this.errorMessage = '';

    const filters: ReportFilters = {
      limit: this.filterForm.value.limit || 10,
      search: this.filterForm.value.search || undefined,
      orderBy: this.filterForm.value.orderBy || undefined,
      order: this.filterForm.value.order || undefined,
      cursor: cursor || this.currentCursor || undefined
    };

    this.reportService.getReports(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (cursor) {
            // Si hay cursor, agregar a la lista existente (paginación)
            this.reports = [...this.reports, ...response.items];
            this.loadingMore = false;
          } else {
            // Si no hay cursor, reemplazar la lista (nueva búsqueda)
            this.reports = response.items;
            this.loading = false;
          }
          this.currentCursor = response.cursor;
          this.hasMore = response.hasMore || false;
        },
        error: (error) => {
          console.error('Error loading reports:', error);
          const statusCode = error?.status || error?.statusCode;
          
          if (statusCode === 403) {
            this.errorMessage = 'No tienes permisos para ver los reportes. Contacta al administrador del sistema.';
          } else if (statusCode === 401) {
            this.errorMessage = 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.';
          } else if (statusCode === 404) {
            this.errorMessage = 'El endpoint de reportes no está disponible. Verifica la configuración del backend.';
          } else {
            const errorMessage = error?.error?.message || error?.message || 'No se pudieron cargar los reportes';
            this.errorMessage = `Error al cargar los reportes: ${errorMessage}`;
          }
          
          this.loading = false;
          this.loadingMore = false;
          this.reports = [];
        }
      });
  }

  /**
   * Aplicar filtros
   */
  applyFilters(): void {
    this.currentCursor = undefined; // Reset cursor al aplicar nuevos filtros
    this.loadReports();
  }

  /**
   * Limpiar filtros
   */
  clearFilters(): void {
    this.filterForm.patchValue({
      limit: 10,
      search: '',
      orderBy: 'username',
      order: 'ASC'
    });
    this.currentCursor = undefined;
    this.loadReports();
  }

  /**
   * Cargar más reportes (scroll infinito)
   */
  loadMore(): void {
    if (this.currentCursor && !this.loadingMore && !this.loading) {
      this.loadReports(this.currentCursor);
    }
  }

  /**
   * Detectar scroll para cargar más automáticamente
   */
  @HostListener('window:scroll', ['$event'])
  onScroll(): void {
    if (this.hasMore && !this.loadingMore && !this.loading) {
      const scrollPosition = window.innerHeight + window.scrollY;
      const documentHeight = document.documentElement.scrollHeight;
      
      // Cargar más cuando esté cerca del final (100px antes)
      if (scrollPosition >= documentHeight - 100) {
        this.loadMore();
      }
    }
  }

  /**
   * Formatear fecha
   */
  formatDate(date: string): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Toggle mostrar/ocultar filtros
   */
  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  /**
   * Ver detalles del reporte
   */
  viewReportDetails(report: Report): void {
    this.selectedReport = report;
    this.showDetailsModal = true;
  }

  closeReportDetails(): void {
    this.showDetailsModal = false;
    this.selectedReport = null;
  }

  getUserInitials(username: string): string {
    if (!username) return '?';
    const parts = username.trim().split(' ');
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (img) {
      img.style.display = 'none';
    }
  }
}

